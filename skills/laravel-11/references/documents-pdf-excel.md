# Documents — PDF (4 libraries), Excel, Barcodes

Read this when generating PDFs, Excel exports/imports (`app/Exports`,
`app/Imports`), or barcodes. The repo intentionally carries **four** PDF
libraries — pick by use case, do not default to one.

## PDF — decision table

| Library | Use when | Avoid when |
|---|---|---|
| **barryvdh/laravel-dompdf** | Simple HTML→PDF from a Blade view: invoices, simple reports, tables. Fastest to wire, no external process. | Complex CSS (flex/grid poorly supported), heavy unicode/RTL, pixel-perfect layouts. |
| **mpdf/mpdf** | Complex documents with solid **unicode** support (Polish/CZ diacritics, mixed scripts), headers/footers, TOC, watermarks, better CSS than FPDF. Pure PHP. | You need modern CSS fidelity (use Browsershot) or you are just stamping an existing PDF (use FPDI). |
| **setasign/fpdf + fpdi** | **Filling/stamping/merging existing PDFs**: import pages from a source PDF as templates, overlay text/images at coordinates, concatenate documents. | Generating layouts from HTML — FPDF has no HTML engine. |
| **spatie/browsershot** | **CSS fidelity requires real Chromium**: modern CSS, charts/JS-rendered content, exact match with the web view. Terraform provisions chromium on the server. | High-volume/queued bulk generation (spawns headless Chrome per render — heavy), environments without Chromium/Puppeteer. |

Rule of thumb: Blade template + tables → **dompdf**; diacritics-heavy or
typographically rich → **mpdf**; existing PDF in, modified PDF out → **fpdf+fpdi**;
"must look exactly like the browser" → **browsershot**.

## Usage snippets

### dompdf (Blade view → PDF)

```php
use Barryvdh\DomPDF\Facade\Pdf;

$pdf = Pdf::loadView('pdfs.invoice', ['invoice' => $invoice])
    ->setPaper('a4');

return $pdf->download("invoice-{$invoice->number}.pdf"); // or ->stream()
$pdf->save(storage_path("app/invoices/{$invoice->id}.pdf"));
```

Keep the Blade template self-contained: inline CSS, absolute paths
(`public_path()`) or base64 for images.

### mpdf

```php
$mpdf = new \Mpdf\Mpdf([
    'mode'   => 'utf-8',
    'format' => 'A4',
]);
$mpdf->SetHTMLHeader('<div style="text-align:right">{PAGENO}</div>');
$mpdf->WriteHTML(view('pdfs.report', $data)->render());
$mpdf->Output(storage_path('app/reports/report.pdf'),
    \Mpdf\Output\Destination::FILE);          // ::DOWNLOAD / ::INLINE / ::STRING_RETURN
```

mpdf writes temp files — make sure its temp dir is writable inside the
container (`'tempDir' => storage_path('app/mpdf-tmp')` in the constructor
config if the default is not).

### fpdf + fpdi (fill / merge existing PDFs)

```php
use setasign\Fpdi\Fpdi;

$pdf = new Fpdi();
$pageCount = $pdf->setSourceFile(storage_path('app/templates/contract.pdf'));

for ($i = 1; $i <= $pageCount; $i++) {
    $tplId = $pdf->importPage($i);
    $pdf->AddPage();
    $pdf->useTemplate($tplId);

    if ($i === 1) {                       // stamp values on page 1
        $pdf->SetFont('Helvetica', '', 10);
        $pdf->SetTextColor(0, 0, 0);
        $pdf->SetXY(35, 120);             // mm from top-left
        $pdf->Write(0, $customerName);
    }
}

$pdf->Output('F', storage_path('app/contracts/filled.pdf'));
```

Merging = loop `setSourceFile()` over multiple files, importing every page into
one `Fpdi` instance. Caveats: FPDI's free parser does not read PDFs with
compressed cross-reference streams (PDF 1.5+ from some generators) — re-save
the source as 1.4 or use the paid parser add-on. Core FPDF fonts are
latin1-ish; for diacritics in stamped text add a UTF-8 TTF font via `AddFont`
or generate with mpdf instead.

### browsershot (Chromium)

```php
use Spatie\Browsershot\Browsershot;

Browsershot::html(view('pdfs.fancy-report', $data)->render())
    ->format('A4')
    ->showBackground()          // print CSS backgrounds
    ->margins(10, 10, 10, 10)   // mm
    ->waitUntilNetworkIdle()    // if the page loads assets/JS
    ->save(storage_path('app/reports/fancy.pdf'));

// or from a live URL:
Browsershot::url(route('reports.print', $report))->save($path);
```

Requires node + puppeteer + Chromium on the machine (provisioned by the
Terraform `chromium` module on the server; inside Sail check availability
before relying on it locally). Generate in a **queued job**, never inline in a
web request — cold Chromium start is slow.

## maatwebsite/excel (Laravel Excel 3.1)

Export classes in `app/Exports`, import classes in `app/Imports`.

### Exports

```php
namespace App\Exports;

use Maatwebsite\Excel\Concerns\{FromQuery, Exportable, WithHeadings, WithMapping};

class OrdersExport implements FromQuery, WithHeadings, WithMapping
{
    use Exportable;

    public function query()                       // FromQuery => chunked under the hood
    {
        return Order::query()->with('customer')->whereYear('created_at', 2025);
    }

    public function headings(): array
    {
        return ['ID', 'Customer', 'Total'];
    }

    public function map($order): array
    {
        return [$order->id, $order->customer->name, $order->total];
    }
}
```

```php
return Excel::download(new OrdersExport, 'orders.xlsx');   // response
Excel::store(new OrdersExport, 'exports/orders.xlsx', 'local');
```

Prefer `FromQuery` over `FromCollection` for anything big — the query is
executed in chunks. Eager-load relations used in `map()` or you get N+1 per
chunk.

**Queued exports** (large datasets — required for anything beyond a few
thousand rows on a web request):

```php
(new OrdersExport)->queue('exports/orders.xlsx')->chain([
    new NotifyExportReady($user->id),
]);

// or implicit: implement ShouldQueue on the export class, then ->store() queues it.
class OrdersExport implements FromQuery, ShouldQueue { use Exportable; ... }
```

Queued exports run as multiple jobs (one per chunk) appending to the same file
on the configured disk — works with the database queue driver; make sure a
`queue:work` process is running.

### Imports

```php
namespace App\Imports;

use Illuminate\Contracts\Queue\ShouldQueue;
use Maatwebsite\Excel\Concerns\{ToModel, WithHeadingRow, WithChunkReading, WithBatchInserts};

class ProductsImport implements ToModel, WithHeadingRow, WithChunkReading, WithBatchInserts, ShouldQueue
{
    public function model(array $row)
    {
        return new Product([
            'sku'  => $row['sku'],          // WithHeadingRow => string keys
            'name' => $row['name'],
        ]);
    }

    public function chunkSize(): int { return 1000; }  // rows read per queue job
    public function batchSize(): int { return 1000; }  // models per insert query
}
```

```php
Excel::import(new ProductsImport, $request->file('file'));
```

- **Always** combine `WithChunkReading` + `WithBatchInserts` for large files —
  without chunking the whole spreadsheet is loaded into memory.
- `ShouldQueue` on an import requires `WithChunkReading` (each chunk becomes a
  queue job).
- Validation per row: add `WithValidation` and a `rules(): array` method;
  collect failures with the `SkipsOnFailure` / `SkipsFailures` pair instead of
  aborting the whole import.

## milon/barcode

Generates 1D/2D barcodes (C39, C128, EAN13, QRCODE, PDF417...) without
external services. Typical use in Blade/PDF templates:

```php
use Milon\Barcode\Facades\DNS1DFacade as DNS1D;
use Milon\Barcode\Facades\DNS2DFacade as DNS2D;

$png  = DNS1D::getBarcodePNG('5901234123457', 'EAN13');   // base64 (no data: prefix)
$svg  = DNS1D::getBarcodeSVG('123456789', 'C128');
$qr   = DNS2D::getBarcodePNG(route('orders.show', $order), 'QRCODE');
```

```blade
<img src="data:image/png;base64,{{ DNS1D::getBarcodePNG($order->ean, 'EAN13') }}">
```

For dompdf/mpdf output, embed as base64 PNG (as above) — SVG support in dompdf
is limited. Height/width/color tuning via the extra arguments
`getBarcodePNG($code, $type, $widthFactor, $height, $color)`.
<!-- TODO-verify: milon/barcode facade class names and the optional
     width/height/color argument order were written from package README
     knowledge, not verified against a live doc source (package not indexed
     in context7). Methods getBarcodePNG/getBarcodeSVG/getBarcodeHTML and the
     DNS1D/DNS2D split are stable across versions; double-check the facade
     import path against the installed version's ServiceProvider aliases. -->
