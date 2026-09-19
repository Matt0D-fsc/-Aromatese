# Bulk Product Import — Design

Written 2026-09-20. Getting a catalog in is the first hour of every merchant's life on ChatNab, and today it
is one product at a time. A shop with 200 sarees gives up before the AI has anything to sell.

Decided with the platform owner:
- **Sources:** Excel / Google Sheet, Facebook page posts, and the phone photo gallery.
- **Photos with a sheet:** a zip of photos, matched to rows by file name.
- **Duplicates:** never block the import. Import everything that is new, flag every likely duplicate, and let the
  merchant decide each one afterwards.

---

## One pipeline, three front doors

Every source ends in the same place: a list of **draft products** the merchant reviews before anything is
saved. The sources only differ in how the drafts are made.

```
Sheet (+ zip)  ─┐
Photo gallery  ─┼─►  drafts  ─►  review screen  ─►  import  ─►  report + duplicates queue  ─►  AI enrich
Facebook posts ─┘
```

| Source | How drafts are made | What the merchant fills in |
|---|---|---|
| Sheet (+ zip) | One draft per product; rows with the same name and a Size/Colour become variants | Only what failed validation |
| Photo gallery | AI reads each photo and drafts title, category, description, tags | Price and stock (the AI never guesses these) |
| Facebook posts | Photos plus caption; the AI pulls name and price out of the caption ("Price 1200tk") | Stock, and anything the caption left out |

## Where the work happens

In the **browser**, not on the server. The files are the merchant's, on the merchant's device:
- The sheet is parsed in the browser (`.xlsx` and `.csv`). A Google Sheet link is fetched as CSV by the server,
  since the sheet lives at Google, not on the phone.
- The zip is opened in the browser, each photo shrunk with `lib/shrink-image.ts`, and uploaded straight to this
  shop's storage folder, exactly as the product form does today.
- Only the finished drafts (text plus photo URLs) reach a server action, in batches of 50.

This keeps big zips off the server entirely: no upload size limit to fight, no background worker to run,
no temporary files to clean up. The cost is that the page must stay open while photos upload; it shows
progress, and a closed tab can be resumed because nothing is written until the merchant presses Import.

## The sheet

**Template.** A downloadable template with the columns in English and Bangla, and three example rows:

| Column | Required | Notes |
|---|---|---|
| Name | yes | English or Bangla |
| Price | yes | Digits; "1,200", "1200tk" and "৳1200" are all read as 1200 |
| Sale price | | Must be below Price |
| Stock | yes | Blank reads as 0 |
| Size / Colour | | Rows sharing a Name become one product with variants |
| Category, Brand, Description | | |
| SKU | | Generated when blank, as the product form does |
| Photos | | File names from the zip, comma separated |

**Their own sheet.** Merchants will not use the template. Headers are matched automatically against English,
Banglish and Bangla synonyms ("Product", "Item", "নাম", "Dam", "দাম", "Qty", "স্টক"...), and the merchant
confirms or fixes the match on one screen before anything else happens.

**Bangla text.** `.xlsx` keeps Bangla intact. A `.csv` saved from Excel in the old "CSV" format is not UTF-8
and turns Bangla into question marks; the import detects that and tells the merchant to use `.xlsx` or
"CSV UTF-8", instead of importing garbage.

**Photos from the zip.** Matched by the Photos column; when that is empty, a file whose name starts with the
row's SKU is used. Files matched to no row, and rows naming a file that is not in the zip, are both listed on
the review screen.

## Review screen

One table, every draft, before anything is written:
- **Ready** — will be created.
- **Needs a fix** — missing price, price not a number, sale price above price. Editable in place.
- **Likely duplicate** — imported anyway only if the merchant changes nothing; see below.

Limits per import: 2,000 rows and 10 photos per product. Bigger catalogs import in parts.

## Duplicates

The merchant asked for the import to finish and the duplicates to be flagged with an action, not to be
stopped at the door.

A draft is a likely duplicate when it matches an existing product (or another draft in the same import) by:
1. the same SKU, or
2. the same name after normalising case, spacing and punctuation.

The SKU is unique per shop in the database (`unique_sku_per_tenant`), so a same-SKU duplicate cannot be
created as a new product at all; a same-name one can.

Every other draft is imported. Duplicates are held in a queue and the import report says
"180 added · 12 need a decision". Each flagged draft shows the existing product side by side with what the
sheet says, and one action:

| Action | Effect |
|---|---|
| **Update existing** (suggested for same SKU) | Price, sale price, stock, and any field the sheet filled in are written onto the existing product. Photos are added, not replaced. |
| **Add as new** (suggested for same name, different SKU) | Created as its own product, with a fresh SKU if it collided. |
| **Skip** | Nothing changes. |

"Apply the suggested action to all" handles the common case — re-importing last week's sheet to update
stock — in one tap. The queue stays on the Products page until it is empty, so a merchant can come back to it.

## After import: AI enrich

Search and voice matching work off `title_bn`, `title_banglish` and `voice_tags`, which a sheet almost never
has. Imported products that lack them are queued for the existing AI fill (`autofillProduct`, which already
reads the product photos), run one at a time from the browser with a progress bar. Anything the merchant
filled in is kept; the AI fills the blanks, as it does in the product form today. Resumable: it simply
continues with whichever imported products are still missing Bangla.

## Photo gallery import

Drop up to 50 photos. Each is shrunk and uploaded, then the AI drafts one product per photo. On the review
screen the merchant can select several photos and **merge** them into one product (front, back, detail),
and must enter price and stock before a draft can be imported. Duplicates are checked on the AI's title, the
same way as for a sheet.

## Facebook page posts

Needs a Meta app with page permissions, which means the same app review as Messenger. Design now, build after
approval, so both land together:
- The merchant connects their Page once (the same connection Messenger will use).
- ChatNab lists their recent posts that have photos; the merchant ticks which ones are products.
- Each ticked post becomes a draft: the photos, plus name and price pulled from the caption by the AI.
- From there it is the gallery import's review screen.

## Data

Two tables, so an import can be reviewed, resumed and audited:

```
import_jobs  (id, tenant_id, source: sheet|photos|facebook, file_name, created_by, created_at,
              counts: added / updated / skipped / needs_decision)
import_rows  (id, job_id, tenant_id, row_number, draft JSONB, status: added|updated|skipped|duplicate|error,
              product_id, match_product_id, match_reason: sku|name, error)
```

Read under row-level security by the shop's members; written only by server actions, like everything else a
merchant changes. The rows are what the duplicates queue reads, and what the audit trail points at.

## Build order

1. **Sheet import** — template, `.xlsx`/`.csv`/Google Sheet link, column matching, variants, review screen,
   duplicates queue, import report. The biggest win on its own.
2. **Zip photos** — matched by file name, shrunk and uploaded from the browser.
3. **AI enrich** — Bangla titles and tags for everything imported.
4. **Photo gallery import** — AI drafts, merge, price and stock entry.
5. **Facebook posts** — after Meta app review, alongside Messenger.

New dependencies, and why: one `.xlsx` reader and one zip reader, both browser-side. Neither format can be read
reasonably by hand, and both run on the merchant's device.
