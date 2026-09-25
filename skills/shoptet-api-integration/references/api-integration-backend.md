---
name: shoptet-api-integration-backend
description: Shoptet Private API pro backend/ERP integrace (více e-shopů, webhooky, batch, snapshoty) — auth, rate limity, webhook podpis a idempotence, JSONL batch/async joby, snapshoty, feedy a integration pitfalls.
---

# Shoptet API — Backend/ERP integrace (multi-shop)

Doplněk k `references/api.md` (obecný přehled API). Tenhle soubor je pro situaci, kdy backend
(typicky vlastní ERP/PIM, Laravel nebo jiný stack) synchronizuje **více Shoptet e-shopů najednou**
přes webhooky + Private API + batch importy — tj. přesně situace jako u Cutegory (Shoptet)
nebo u vlastního ERP napojeného na 8+ shopů.

Všechna tvrzení níže jsou ověřená živě 2026-09-25 scrapem `api.docs.shoptet.com` a
`developers.shoptet.com` (viz `references/sources.md` pro přesné URL). Kde dokumentace mlčí,
je to označené jako "obecné doporučení", ne jako zdokumentované chování Shoptetu.

## 1. Autentizace — rychlá rekapitulace

| Režim | Header | Kdy použít |
|---|---|---|
| **Private API (Premium)** | `Shoptet-Private-API-Token` | Vlastní/klientský e-shop, přímý přístup, token vytvořený v adminu, práva přes "endpoint groups" (při vytvoření má token přístup ke všem, dá se zúžit) |
| **Addon API (OAuth2)** | `Shoptet-Access-Token` (získaný přes `Bearer <OAuth access token>` na `https://<eshop>.tld/action/ApiOAuthServer/getAccessToken`) | Partner addon distribuovaný na cizí e-shopy; max 5 platných tokenů současně |

Pro multi-shop ERP integraci (více e-shopů, každý s vlastním tokenem) je nejčastější Private API
— **token je vždy per-eshop**, nikdy sdílený napříč shopy. To platí i pro webhook signature key
(viz níže) — je nutné mít samostatný klíč a samostatnou registraci webhooků PRO KAŽDÝ SHOP.

## 2. Webhooky

### 2.1 Registrace (API)

| Akce | Endpoint |
|---|---|
| Seznam registrovaných | `GET /api/webhooks` |
| Registrace (až 50 najednou) | `POST /api/webhooks` |
| Detail | `GET /api/webhooks/{id}` |
| Úprava | `PATCH /api/webhooks/{id}` |
| Smazání | `DELETE /api/webhooks/{id}` |
| Vygenerování/rotace podpisového klíče | `POST /api/webhooks/renew-signature-key` |
| Log doručení | `GET /api/webhooks/notifications` |

```json
POST /api/webhooks
{
  "data": [
    { "event": "order:create", "url": "https://myapp.tld/orders.php", "sendPayload": "full" }
  ]
}
```

Klíčová pravidla (zdroj: `webhooks/registernewwebhook`, `developers.shoptet.com/webhooks/`):

- **Na jeden `event` lze zaregistrovat JEN JEDNU URL.** Druhý pokus o registraci stejného
  eventu vrací `409 Conflict` (chyba `duplicate` v `errors`, HTTP 201 s částečným úspěchem, pokud
  registruješ víc eventů najednou a jen některé kolidují; `422` + `data: null`, pokud selžou VŠECHNY).
  → **Důležité:** přeregistrace webhooků (např. při každém deployi)
  musí nejdřív `DELETE` starou registraci a pak `POST` novou — nejde jen "přeregistrovat přes"
  existující. Pokud staging omylem použije produkční token a spustí re-registraci, **smaže
  produkční webhook a nahradí ho stagingovou URL** — proto STAGING NIKDY nesmí mít produkční
  Shoptet tokeny (viz pitfalls níže).
- **Registrace je per-instalace** = per (addon, e-shop) dvojice, resp. per Private API token
  daného e-shopu. Nejde nastavit jeden webhook, který by chytal eventy ze všech shopů najednou —
  pro 8 shopů je nutná 8× samostatná registrace + 8× samostatný signature key.
- `url` max 2000 znaků, povolené porty 80/8080/443/8443.
- Změny v "add-on events" registraci se aplikují okamžitě, bez schvalovacího procesu.

### 2.2 Tvar payloadu

Základní notifikace (vždy):

```json
{
  "eshopId": 222651,
  "event": "order:create",
  "eventCreated": "2025-02-08T15:13:39+0100",
  "eventInstance": "2025000057"
}
```

- `eventInstance` = identifikátor entity, **typ se liší podle eventu** (číslo objednávky/faktury,
  GUID produktu/zákazníka/kategorie, `productGuid|variantCode` pro varianty, JSON-serializovaný
  seznam ID u mass eventů). Nikdy nepředpokládej jeden formát napříč eventy.
- Volitelně `payload` (viz 2.3).

**Payload delivery (opt-in, `sendPayload: "full"`):** notifikace obsahuje navíc `payload.data`
se stejným tvarem jako GET detail dané entity (a to i s `include` parametry pro order/product/
invoice/creditNote/deliveryNote/proformaInvoice — tedy bohatší než default GET). Pokud fetch
payloadu při doručení selže (transientní chyba), notifikace dorazí BEZ `payload` — počítej s tím,
že payload je "best effort", ne garance, a musíš mít fallback na GET podle `eventInstance`.
Mass eventy (`order:massUpdate` apod.) payload nikdy nemají.

### 2.3 Relevantní eventy pro objednávky/zákazníky/doklady/joby

| Event | Identifikátor | Payload | Poznámka |
|---|---|---|---|
| `order:create` | číslo objednávky | ano | |
| `order:update` | číslo objednávky | ano | `409 Conflict`, pokud registruješ zároveň `order:cancel` |
| `order:cancel` | číslo objednávky | ne | emitován při přechodu stavu na `canceled`; `409` s `order:update` |
| `order:delete` | číslo objednávky | ne | |
| `order:paid` | číslo objednávky | ne | NEemituje se při vytvoření rovnou zaplacené objednávky (`order:create`/`massCreate` to pokrývá) — jen při přechodu nezaplaceno→zaplaceno |
| `order:massCreate/massUpdate/massPaid` | JSON seznam čísel | ne | mass eventy nemají payload |
| `customer:create/update/delete/import` | GUID zákazníka | create/update ano | `customer:update` je `409 Conflict` s `enableOrders`/`disableOrders` |
| `customer:enableOrders`/`disableOrders` | GUID zákazníka | ne | vzájemně i s `customer:update` v konfliktu (409) |
| `invoice:create/update/delete`, `proformaInvoice:*`, `creditNote:*`, `deliveryNote:*`, `proofPayment:*` | číslo dokladu | create/update ano, delete ne | |
| `job:finished` | job `id` | ne | **POVINNÝ pro async endpointy** — bez registrace tohoto webhooku async request vrátí `403` a job se vůbec nezařadí do fronty (viz 4.1) |

Plný code list (~90 eventů vč. `product:*`, `stock:*`, `shipment:*` beta) je v `references/api.md`
— tabulka výše je jen průřez pro order/customer/doklady/joby relevantní pro ERP sync.

### 2.4 Signature — přesný mechanismus (ověřeno)

**Header:** `Shoptet-Webhook-Signature`
**Algoritmus:** `HMAC-SHA1` nad **syrovým tělem requestu** (raw JSON string, ne parsované pole).

```
ShoptetWebhookSignature = hash_hmac('sha1', $rawBody, $signatureKey)
```

`$signatureKey` získáš jednorázově (a při potřebě rotace znovu) přes
`POST /api/webhooks/renew-signature-key` (bez body). Endpoint **VŽDY vygeneruje nový klíč** —
staré podpisy s předchozím klíčem přestanou sedět, takže rotace znamená koordinovaný update na
obou stranách. Klíč je vázaný na (addon, e-shop) instalaci = **per e-shop, ne globálně sdílený**
— pro 8 shopů je 8 nezávislých klíčů, ulož je s jasnou vazbou na `eshopId`.

PHP verifikace (doslovný příklad z developer docs, doplněný o `hash_equals` — v dokumentaci je
jen `===`, ale pro timing-safe porovnání HMACů použij vždy `hash_equals`):

```php
<?php
// $rawBody = file_get_contents('php://input');  -- MUSÍ být raw body, ne $request->all()
$signatureKey = config('services.shoptet.webhook_signature_keys')[$eshopId] ?? null;

if ($signatureKey === null) {
    abort(401, 'Unknown eshop');
}

$expected = hash_hmac('sha1', $rawBody, $signatureKey);
$received = $request->header('Shoptet-Webhook-Signature', '');

if (! hash_equals($expected, $received)) {
    abort(401, 'Invalid webhook signature');
}
```

**DŮLEŽITÉ pro Laravel:** čti tělo přes `$request->getContent()` (raw), ne
`$request->all()`/`$request->input()` — jakékoliv přeparsování a znovu-serializace JSONu (i s
jinak identickým obsahem) změní bajtovou reprezentaci a HMAC nebude sedět kvůli pořadí klíčů,
mezerám nebo escapování unicode. Middleware, který loguje/dumpuje request body před verifikací,
riskuje stejný problém, pokud si ho pak přebíráš zpátky přes `json_encode`.

Sekundární (ne náhradní) obranná vrstva: Shoptet posílá notifikace **jen z rozsahu
`185.184.254.0/24`** — dá se použít jako doplňkový allowlist na firewallu/nginx, ale
**nenahrazuje signature check** (IP rozsah je sdílený mezi všemi zákazníky Shoptetu, ne unikátní
per shop).

### 2.5 Retry, ordering, idempotence

- **Timeout na potvrzení: 4 sekundy.** Musíš vrátit HTTP 200 do 4s, jinak Shoptet request
  považuje za nedoručený.
- **Retry: max 2 opakování (3 pokusy celkem)**, s odstupem **15 minut**. Pokud ani poslední pokus
  není potvrzen (200), notifikace se označí jako **inactive** (Shoptet ji dál neopakuje) —
  to znamená, že bez vlastního reconciliation mechanismu (např. pravidelný `GET
  /api/webhooks/notifications` audit nebo periodický full snapshot) může eventy trvale ztratit,
  pokud tvůj endpoint měl výpadek déle než ~30 minut. Typický následek (aktualizace
  objednávek se tiše ztrácejí) — na straně Shoptetu k tomu navíc přispívá vlastní retry limit.
- **Žádná garance pořadí.** Dokumentace explicitně říká, že notifikace **mohou být doručeny
  paralelně** (ne nutně sekvenčně jedna po druhé). Nespoléhej na to, že `order:create` dorazí
  dřív než navazující `order:update` pro stejnou objednávku — implementuj sync jako "fetch
  current state podle `eventInstance`", ne jako aplikaci diffu z payloadu.
- **Doporučený vzor (obecné doporučení, ne Shoptet-dokumentované):** webhook handler má dělat
  jen dvě věci rychle (do 4s) — (1) ověřit signature, (2) zapsat `(eshopId, event, eventInstance,
  eventCreated)` do fronty/tabulky a vrátit 200. Skutečné zpracování (fetch entity, zápis do ERP)
  dělej asynchronně z fronty. To přesně odpovídá doporučení v developer docs ("you should only
  store the change identifier... further processing should be handled asynchronously") a řeší
  typický problém (synchronní plný import v `sleep(10)` jobu na webhooku).
- **Dedup klíč:** `(eshopId, event, eventInstance)` NENÍ zaručeně unikátní přes čas (např.
  `order:update` může přijít 5× za sebou pro stejnou objednávku s různým `eventCreated`) — pro
  idempotentní zpracování dedupuj podle `(eshopId, event, eventInstance, eventCreated)` NEBO
  ještě lépe podle skutečného stavu entity (`changeTime` z GET response), ne podle webhook ID.
  Shoptet sám dovoluje duplicitní/souběžné doručení ("may be delivered in parallel") — bez
  DB-level unique constraint + `lockForUpdate`/upsert na straně ERP hrozí dvojí odeslání do externích systémů (např. KSeF) a duplicitní objednávky.

### 2.6 Proč delete eventy ověřovat znovu přes API (ne jen podle podpisu)

Signature garantuje, že notifikaci poslal Shoptet a nebyla cestou pozměněná. **Negarantuje ale,
že v okamžiku zpracování webhooku je entita pořád smazaná** — mezi doručením a zpracováním (které
puberálně čeká ve frontě) mohla entita znovu vzniknout se stejným identifikátorem, notifikace
mohla dorazit ze staré/opožděné retry vlny, nebo (u nepodepsaných endpointů, jako byl dřívější
stav audit finding) šlo o čistě podvržený request na veřejnou routu bez jakéhokoliv ověření.

Doporučený vzor pro destruktivní eventy (`order:delete`, `customer:delete`, `invoice:delete`,
`creditNote:delete`, `deliveryNote:delete`, `proofPayment:delete`, `brand:delete`,
`category:delete`, `discountCoupon:delete`, ...): **po ověření signatury ještě zavolej `GET`
na danou entitu (`/api/orders/{code}`, `/api/customers/{guid}`, ...) a smaž lokální záznam JEN
pokud Shoptet vrátí `404`.** Pokud entita pořád existuje (200), webhook byl buď zastaralý, nebo
šlo o cizí `order:cancel`/jinou změnu mylně namapovanou na delete handler — nemazat. Tohle je
přesně oprava k audit finding ("Ověřit přes API, že záznam vrací 404").

### 2.7 Mass webhooky

Mass eventy (`order:massCreate`, `order:massUpdate`, `order:massPaid`, `product:massUpdate`, …)
nesou JSON-serializovaný seznam ID/kódů místo jednoho `eventInstance`, **nemají payload** a
Shoptet je posílá navíc k jednotlivým "single" eventům pro každou entitu (dokumentace avizuje, že
se to v budoucnu změní — sleduj changelog, pokud na mass eventy začneš spoléhat jako na jediný
zdroj pravdy).

## 3. Private API — auth, limity, chyby, stránkování

### 3.1 Rate limiting a concurrency

- **Per IP:** max 50 souběžných spojení. **Per token:** max 3 souběžná spojení. Nad limit → `429`.
  Pozor: to je limit na *souběžnost*, ne na *počet requestů/min* — počet dotazů ani objem dat
  omezený není.
- **Leaky bucket:** každá odpověď nese `X-RateLimit-Bucket-Filling: <used>/<max>`; při naplnění
  bucketu navíc `Retry-After: <HTTP date>`. Implementuj honor těchto hlaviček (respektuj
  `Retry-After` doslova, needěl vlastní backoff heuristiku), viz
  `developers.shoptet.com/api/documentation/rate-limiter/`.
- **Locks (423):** zápisové endpointy (DELETE/PATCH/POST/PUT) zamykají cílovou URL na dobu
  zpracování (max 5s). Druhý identický request ve stejném okně dostane `423 Locked` — retry
  s malým odstupem, nikdy okamžitý retry ve smyčce.
- Pro 8 shopů běžících paralelně **drž rate limiting per-shop token**, ne globálně — limity jsou
  vázané na konkrétní token/IP, ne na tvůj účet napříč shopy.

### 3.2 Chybové kódy (kompletní tabulka, ověřeno `basic-principles/status-codes`)

| Kód | Význam | Retry? |
|---|---|---|
| 400 | Validace na úrovni položky selhala | Ne, request je trvale špatný |
| 401 | Neplatný/expirovaný token (addon access token) | Ne, potřeba nový token |
| 403 | Bez práv na endpoint (addon), nebo chybí potřebný modul | Ne |
| 404 | Endpoint nebo entita neexistuje | Ne |
| 409 | Konflikt (duplicita, porušení vztahu, kolize registrace webhooků) | Ne, oprav konflikt |
| 413 | Payload too large (překročen limit počtu entit v bulk requestu) | Ne, rozděl request |
| 422 | Nezpracovatelná entita (špatný JSON/schema) | Ne |
| 423 | Locked (souběžný zápis na stejnou URL) | Ano, s malým odstupem |
| 429 | Rate limit (concurrency) | Ano, dle `Retry-After` |
| 500 | Obecná chyba serveru | Ano, s backoffem |
| 503 | Údržba (např. přesun DB) | Ano, později |

Pro **PATCH/PUT nad více záznamy najednou** (batch endpointy mimo async JSONL batch) platí
speciální pravidlo: úspěšná odpověď `200` NEZNAMENÁ, že prošly všechny položky — `errors` pole
obsahuje info o přeskočených řádcích, i když je top-level status 200.

### 3.3 Stránkování

`page` (od 1) + `itemsPerPage` (default i max se liší endpoint od endpointu — u velkých dumpů
raději použij Snapshot endpointy místo stránkování přes tisíce záznamů, viz sekce 5).

### 3.4 Deprecation signalizace

Response hlavičky `X-Shoptet-Deprecated` + `Sunset: <datum>` signalizují, že voláš endpoint/verzi,
která bude vyřazena — logu tyto hlavičky a nastav alert, ať se o breaking change dozvíš dřív než
v produkci.

## 4. Async joby

### 4.1 Kdy je endpoint asynchronní a proč `job:finished` webhook musíš mít

Async/sync je vlastnost KONKRÉTNÍHO endpointu (ne runtime rozhodnutí) — typicky produktové
obrázky, batch update/delete a snapshoty. Response na async request:

```json
{ "data": { "jobId": "3ax1844" } }
```

**Kritické:** pokud nemáš zaregistrovaný webhook `job:finished`, Shoptet vrátí `403` a job se
**vůbec nezařadí do fronty** — tzn. bez tohoto webhooku nefunguje batch update/delete ani
snapshot vůbec, ne jen "bez notifikace o dokončení".

### 4.2 Lifecycle joba

`GET /api/system/jobs/{jobId}` (detail) / `GET /api/system/jobs/` (seznam, 30denní historie):

| Stav | Význam |
|---|---|
| `pending` | čeká ve frontě |
| `running` | zpracovává se |
| `completed` | hotovo, `resultUrl` platný |
| `failed` | selhalo, detail v `log` |
| `expired` | výsledek existoval, ale `validUntil` uplynulo |
| `killed` | neočekávaně ukončeno |

- `resultUrl` (pokud job produkuje výstup, typicky snapshoty) je platný **24 hodin** od
  `validUntil`, pak expiruje. Stáhni si výsledek hned po `job:finished`, neuchovávej jen odkaz.
- Metadata joba a `log` se drží **30 dní**.
- **Webhook `job:finished` se emituje i při selhání** (`status: failed`) — vždy over si `status`
  v Job detail, neber `job:finished` jako "úspěch". Výjimka: pokud job selže interní chybou a je
  automaticky označen za failed **3 hodiny** po vytvoření (timeout), `job:finished` se v tomto
  konkrétním případě **NEemituje** — proto pro dlouho běžící/kritické joby (KSeF-třídy) měj vlastní
  watchdog s timeoutem kratším než 3h, který kontroluje `GET /api/system/jobs/{jobId}` sám, pokud
  webhook nedorazí.

## 5. Batch operace (JSONL, `PATCH`/`DELETE /api/products/batch`)

### 5.1 Formát a limity

- **Formát: JSON Lines** (https://jsonlines.org/) — jeden JSON objekt na řádek, ne JSON pole.
- **Max velikost souboru: 100 MB.**
- Request tělo obsahuje jen `batchFileUrlPath` — URL, odkud si Shoptet soubor sám stáhne
  (`GET` na tvou URL). Soubor tedy **hostuje integrátor**, ne Shoptet — bezpečnost té URL je
  tvoje zodpovědnost (viz pitfalls níže).

```json
PATCH /api/products/batch
{ "batchFileUrlPath": "https://cdn.example.com/exports/batch-<uuid>.jsonl" }
```

Odpověď `202 Accepted` s `{"data": {"jobId": "ad24xod"}}` — batch je vždy async, viz sekce 4.

### 5.2 Update vs delete

| Endpoint | Metoda | Řádek obsahuje | Chování při chybě řádku |
|---|---|---|---|
| Product batch update | `PATCH /api/products/batch` | stejná struktura jako single product update, + volitelný `language` pro multi-jazyčné pole (name/description) | řádek se přeskočí a chyba zaloguje, **zpracování ostatních řádků pokračuje** — žádný rollback celého souboru |
| Product batch delete | `DELETE /api/products/batch` | `guid` (smaže celý produkt) NEBO `code` (smaže variantu; pokud produkt má jen 1 variantu, smaže celý produkt) | stejně — per-řádek skip, ne all-or-nothing |

- **Batch update NEMÁ `resultUrl`** — výsledky (úspěšné položky + chyby) najdeš v `log` poli
  Job detailu (`GET /api/system/jobs/{jobId}`), identifikace řádku je **podle pozice v souboru**
  (číslováno od 1), ne podle obsahu — pokud potřebuješ mapovat chybu zpátky na entitu ve svém
  ERP, musíš si udržet vlastní index řádek→interní ID při generování JSONL.
- Order batch insert existuje také (`POST` batch pro objednávky, `orderbatchinsertion`; dostupné od 25. 3. 2025, https://developers.shoptet.com/api-release-news-from-march-25-2025/), stejný
  JSONL vzor.
- Pricelist má vlastní batch endpoint (`PATCH /api/pricelists/{id}/batch`).

### 5.3 Idempotence batch souborů

Dokumentace negarantuje idempotenci na úrovni celého batch requestu (žádný "batch ID" dedup) —
pokud stejný `batchFileUrlPath` zavoláš dvakrát (např. retry po timeoutu tvého HTTP klienta, aniž
bys věděl, jestli první request prošel), Shoptet spustí **dva nezávislé joby**, které oba
zpracují stejná data znovu. Obecné doporučení (mimo dokumentaci): generuj JSONL soubory s
unikátním názvem/UUID na cestě a loguj `jobId` navázaný na tvůj vlastní "sync run" záznam PŘED
odesláním requestu, ať dokážeš detekovat a nepouštět duplicitní batch run.

## 6. Snapshoty (plný dump)

`GET /api/products/snapshot` a `GET /api/orders/snapshot` — asynchronní plný export všech
záznamů (typicky pro inicializační sync nebo periodickou rekonciliaci proti driftu, ne pro
běžný delta sync, na to slouží webhooky + `changeTimeFrom`/`changeTimeTo` filtry).

- Odpověď je stejný async vzor (`jobId` → `job:finished` → Job detail → `resultUrl`).
- **Výsledný soubor je JSONL, navíc GZIP komprimovaný.** Jedna entita = jeden řádek, tvar
  shodný s GET detail response (products snapshot podporuje stejné `include` sekce jako single
  GET — obrázky, kategorie, sklad, ceníky atd., viz `include` parametr).
- Filtrovací parametry pro products snapshot: `productCodes`/`productGuids` (max 50, nekombinuj
  s ostatními filtry), `availabilityId`, `visibility`, `type`, `brandName`/`brandCode`,
  `categoryGuid`/`defaultCategoryGuid`, `flag`, `supplierGuid`, `creationTimeFrom/To`,
  `changeTimeFrom/To` — poslední dva umožňují **inkrementální snapshot** místo full dumpu.
- `resultUrl` platný 24h (stejné pravidlo jako u ostatních jobů, sekce 4.2) — stáhni ihned po
  `job:finished`, neplánuj stažení "až bude čas".
- SDK (`Shoptet\Api\Sdk\Php`) má helper `Sdk::processSnapshotResult($jobId)` / `JobResultProcessor`,
  který vrací iterátor (PHP Generator) nad výsledkem — vhodné pro zpracování bez načtení celého
  souboru do paměti, pokud SDK používáš.

## 7. Feedy, které Shoptet konzumuje (import produktů)

Toto je oblast, kde je oficiální dokumentace řídká — potvrzeno živě jen tolik:

- Import produktů (Administrace → Produkty → Import) přijímá **XLSX, CSV nebo XML**, soubor musí
  být v kódování **Windows-1250 (CP-1250)**, XLS (starý binární formát) není podporovaný.
- Podporovaný XML tvar zahrnuje jak vlastní Shoptet XML specifikaci, tak Heureka feed formát.
- Zdroj nepotvrzuje mechanismus **automatického periodického stažení feedu z URL** (na rozdíl od
  JSONL batch, kde `batchFileUrlPath` explicitně říká "Shoptet si stáhne soubor sám") — pokud
  vlastní ERP generuje XML feed pro Shoptet (stock/ceny), ověř konkrétní nastavení v adminu
  daného e-shopu (dřívější lokální KB `docs/shoptet-automaticke-importy.md` zmiňuje "Automatické
  importy" jako existující funkci — nebylo živě reverifikováno v tomto průchodu).
- **Obecné doporučení (integrace, ne Shoptet-specifické):** ať už feed čte Shoptet automaticky,
  nebo ho jen produkuješ pro srovnávače (Heureka/Zboží.cz/Google Merchant), piš ho vždy
  **atomicky** — generuj do dočasného souboru/cesty a teprve po úspěšném dokončení zápisu ho
  `rename()`/přepni symlink na finální cestu. Bez toho hrozí přesně audit finding: souběžné stažení
  feedu uprostřed zápisu vrátí zkrácený/nevalidní XML/JSONL a příjemce (Shoptet nebo srovnávač)
  dočasně uvidí špatné skladové zásoby nebo ceny.

## 8. Integration pitfalls checklist

Shrnutí gotchas relevantních pro backend/ERP integraci — vycházejí z bodů výše + reálných nálezů
při auditu multi-shop integrace (audit finding, audit finding, audit finding, audit finding):

1. **URL-encoduj path parametry sestavené z `eventInstance` nebo jiných dynamických hodnot.**
   I když je pro většinu eventů `eventInstance` jen číslo/GUID, piš klientský kód defenzivně
   (`rawurlencode()` v PHP) při skládání URL pro navazující GET dotaz — nespoléhej na to, že
   hodnota nikdy neobsahuje `/`, `?` nebo jiné speciální znaky. Bez toho hrozí, že podvržená
   nebo nečekaná hodnota v `eventInstance` přesměruje request na jiný endpoint Shoptet API se
   stejným tokenem (path traversal v rámci API namespace).
2. **Webhook URL nikdy nehardcoduj napříč prostředími.** URL cílového endpointu (`https://
   myapp.tld/...`) generuj z konfigurace prostředí (`APP_URL`/env), ne natvrdo v kódu — jinak
   staging build s produkční konfigurací zaregistruje produkční webhooky na stagingovou doménu
   (nebo naopak) při jakékoliv re-registraci.
3. **Staging NIKDY nesmí mít produkční Shoptet Private API tokeny ani signature key.** Protože
   registrace webhooku je 1:1 na event (sekce 2.1) a re-registrace maže/přepisuje existující,
   spuštění stagingového workeru s produkčním tokenem může nenávratně přepsat produkční webhook
   URL na stagingovou — produkce pak tiše přestane dostávat notifikace, dokud si toho někdo
   nevšimne. Odděl tokeny/klíče per prostředí striktně (env proměnné, ne shared config).
4. **Ověřuj signaturu VŽDY, i v interním/testovacím prostředí** — dočasné "vypnutí ověření pro
   testování" má tendenci se dostat do produkce (přesně audit finding).
5. **Nezpracovávej webhook synchronně v request handleru.** Do 4s limitu (sekce 2.5) se vejde jen
   ověření + zápis do fronty; těžké operace (plný import, e-mail zákazníkovi, KSeF) patří do
   queue jobu s vlastním `$timeout` kratším než retry interval fronty.
6. **Dedupuj a zamykej podle skutečné entity, ne podle webhook notifikace.** Souběžné doručení
   (sekce 2.5) + chybějící `UNIQUE` index na `(eshopId, entita)` je přímá cesta k duplicitám a dvojímu odeslání do externích systémů typu KSeF.
7. **Batch/snapshot joby vyžadují `job:finished` webhook navíc k business webhookům** — snadno se
   zapomene, protože jde o systémový, ne obchodní event; bez něj batch import tiše vrací 403 a nic
   se nezpracuje.
8. **`batchFileUrlPath` je veřejně dostupná URL, kterou si Shoptet stáhne** — negeneruj ji na
   předvídatelné cestě (`/exports/products.jsonl`) bez tokenu/UUID a bez úklidu po zpracování;
   jinak jde o stejnou třídu problému jako audit finding (citlivá data — nákupní ceny, adresy — na
   uhodnutelné veřejné cestě).

---

## Zdroje (ověřeno živě 2026-09-25)

Viz `references/sources.md` pro kompletní seznam s daty scrapu.

<!-- Origin: Petr Rohan | Created: 2026-09-25 | Inspiration: api.docs.shoptet.com, developers.shoptet.com -->
