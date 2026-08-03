# Testing the BFF — Jest 30 + ts-jest + supertest

Unit tests live next to the code (`*.spec.ts`), e2e tests in `test/*.e2e-spec.ts`
with their own `test/jest-e2e.json`. Runner: Jest 30 with ts-jest transform
(NestJS default layout). Commands: `npm run test`, `npm run test:e2e`.

Ground rules:

- Unit tests never hit the network or Redis. Mock `HttpService` and the Redis
  provider; a unit test that needs Laravel running is a broken test.
- E2e tests boot the real Nest app (real GraphQL pipeline, real schema build)
  but override the outermost adapters: `HttpService` / `DatamixerService` and
  the `'REDIS'` provider.
- Assert on behavior visible at the boundary (returned data, thrown
  `GraphQLError`, upstream call arguments) — not on internals.

## Unit: service with mocked HttpService

`HttpService` methods return Observables of an Axios response, so mocks must
return `of({ data, status, ... })`, not plain values or Promises.

```ts
import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosHeaders } from 'axios';
import { CatalogService } from './catalog.service';

const axiosResponse = <T>(data: T, status = 200) => ({
  data,
  status,
  statusText: 'OK',
  headers: {},
  config: { headers: new AxiosHeaders() },
});

describe('CatalogService', () => {
  let service: CatalogService;
  const http = { get: jest.fn(), post: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [CatalogService, { provide: HttpService, useValue: http }],
    }).compile();

    service = moduleRef.get(CatalogService);
  });

  it('returns mapped products', async () => {
    http.get.mockReturnValue(
      of(axiosResponse([{ id: 1, name: 'Chair' }])),
    );

    await expect(service.findProducts()).resolves.toEqual([
      expect.objectContaining({ id: 1, name: 'Chair' }),
    ]);
    expect(http.get).toHaveBeenCalledWith('/api/v1/products', expect.anything());
  });

  it('maps upstream 404 to NOT_FOUND', async () => {
    const err = new AxiosError('Not Found');
    err.response = axiosResponse({ message: 'Not Found' }, 404) as never;
    http.get.mockReturnValue(throwError(() => err));

    await expect(service.findProduct(999)).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
  });
});
```

Notes:

- Errors from `HttpService` are Observable **errors**: mock with
  `throwError(() => err)`, not by rejecting a Promise.
- If the service depends on the shared `DatamixerService` wrapper instead of
  `HttpService` directly (preferred), mock the wrapper — its `get`/`post`
  return Promises, which is simpler: `datamixer.get.mockResolvedValue(...)`.

## Unit: resolver with mocked service

Resolvers are thin, so their tests are thin: verify delegation and arg passing.

```ts
describe('CatalogResolver', () => {
  const catalog = { findProduct: jest.fn() };
  let resolver: CatalogResolver;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CatalogResolver, { provide: CatalogService, useValue: catalog }],
    }).compile();
    resolver = moduleRef.get(CatalogResolver);
  });

  it('delegates to the service', async () => {
    catalog.findProduct.mockResolvedValue({ id: 1, name: 'Chair' });
    await expect(resolver.product(1)).resolves.toEqual({ id: 1, name: 'Chair' });
    expect(catalog.findProduct).toHaveBeenCalledWith(1);
  });
});
```

If a resolver would need heavy mocking, that's a smell: logic belongs in the
service.

## Mocking ioredis

Never connect to Redis in unit tests. Two options:

**Manual mock of the provider token** (default — fastest, zero deps):

```ts
const redis = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG'),
};

const moduleRef = await Test.createTestingModule({
  providers: [SessionService, { provide: 'REDIS', useValue: redis }],
}).compile();

// ...
expect(redis.set).toHaveBeenCalledWith(
  'session:abc', expect.any(String), 'EX', expect.any(Number),
);
```

**`ioredis-mock`** (when tests need real get/set/TTL semantics):

```ts
import RedisMock from 'ioredis-mock';
{ provide: 'REDIS', useValue: new RedisMock() }
```

Always assert the TTL argument on writes — a missing `'EX'` is the classic
immortal-session bug.

## E2e: supertest against /graphql

Boot the whole app, override the upstream + Redis providers, POST operations
to `/graphql`. GraphQL always answers HTTP 200 for resolver errors — assert on
`body.errors`, never on the HTTP status.

```ts
// test/catalog.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatamixerService } from '../src/datamixer/datamixer.service';

describe('Catalog (e2e)', () => {
  let app: INestApplication;
  const datamixer = { get: jest.fn(), post: jest.fn() };
  const redis = { get: jest.fn(), set: jest.fn(), ping: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatamixerService)
      .useValue(datamixer)
      .overrideProvider('REDIS')
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('queries a product', async () => {
    datamixer.get.mockResolvedValue({ id: 1, name: 'Chair', price: 99.9 });

    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `query ($id: Int!) { product(id: $id) { id name price } }`,
        variables: { id: 1 },
      })
      .expect(200);

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.product).toEqual({ id: 1, name: 'Chair', price: 99.9 });
  });

  it('surfaces upstream failure as BAD_GATEWAY', async () => {
    datamixer.get.mockRejectedValue(
      new GraphQLError('Upstream service unavailable', {
        extensions: { code: 'BAD_GATEWAY' },
      }),
    );

    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: `{ product(id: 1) { id } }` })
      .expect(200);

    expect(res.body.data.product).toBeNull();
    expect(res.body.errors[0].extensions.code).toBe('BAD_GATEWAY');
  });

  it('runs a mutation with input', async () => {
    datamixer.post.mockResolvedValue({ items: [{ productId: 1, quantity: 2 }] });
    redis.get.mockResolvedValue(JSON.stringify({ userId: null }));

    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `mutation ($input: AddToCartInput!) {
          addToCart(input: $input) { items { productId quantity } }
        }`,
        variables: { input: { productId: 1, quantity: 2 } },
      })
      .expect(200);

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.addToCart.items).toHaveLength(1);
  });
});
```

Notes:

- `overrideProvider(...).useValue(...)` must be called **before** `.compile()`;
  overriding by string token works for `'REDIS'`.
- Overriding `DatamixerService` (Promise API) keeps e2e mocks simple; override
  `HttpService` only when the test targets the axios wrapper itself.
- Always send `content-type: application/json` (supertest's `.send(object)`
  does) — Apollo Server 5 CSRF prevention rejects `text/plain` POSTs.
- Nullable top-level field + entry in `errors` is the expected error shape;
  a non-nullable field error nulls the parent instead — assert accordingly.
- E2e schema build: `autoSchemaFile` runs at `app.init()`, so decorator
  mistakes ("Object type X must define one or more fields") surface here
  first. If the repo enables the `@nestjs/graphql` CLI plugin, e2e under
  ts-jest needs the AST transformer registered in the jest config
  (`globals.ts-jest.astTransformers` pointing at `@nestjs/graphql/plugin`);
  skip this if fields are decorated explicitly.

## Jest 30 quick notes

- Config lives in `package.json` (`"jest"` key) for unit tests and
  `test/jest-e2e.json` for e2e; both use `ts-jest` transform on `^.+\.ts$`,
  `testEnvironment: "node"`.
- Jest 30 fake timers: `jest.useFakeTimers()` breaks TTL/timeout code paths
  that rely on real timers inside axios — prefer real timers and short
  configured timeouts in tests.
- `jest.clearAllMocks()` in `beforeEach` (or `clearMocks: true` in config) —
  shared `jest.fn()` objects otherwise leak call state between tests.
- Keep e2e suites serial (`--runInBand` is the default effect of a single
  worker in CI containers) if they share the overridden app instance.
