# Lot → Block → Slab

Purpose: the strict three-level stock hierarchy, slab records with auto-calculated SQM, whole/partial slab sales and slab cutting (split).

**Implementation status:** Done (Step 3). Sale-side use (partial/full sale through a DN) depends on Step 6.

## 1. Business purpose

Natural stone is bought in batches (lots) of quarry blocks, each cut into slabs that differ in size and shade. The customer chooses specific slabs, so every slab must be traceable to its block and lot, and the lot carries the landed cost. Spec §3.1.2–3.1.5, BD-02, BD-03.

## 2. Actors and roles

- Storekeeper: enters lots/blocks/slabs (opening stock, GRN) and cuts slabs.
- Owner / Manager: all of the above plus SQM override.
- Sales Staff: picks slabs on sales documents (Planned, Step 5).

## 3. Workflow and statuses

```
Lot (created at GRN or opening stock) → Block(s) → Slab(s)
Slab: AVAILABLE → RESERVED → PARTIALLY_SOLD → SOLD
       └─ physical cut → SPLIT (parent) + new child slabs (AVAILABLE) + wastage
```

- **Slab products:** a lot needs at least one block; each block at least one slab; SQM comes from the slabs.
- **Tile products:** no slabs; SQM held at lot level (`tileSqm`) or per block (block SQM), never both.
- `LotSource`: `OPENING` or `GRN`.
- `SlabOperationType`: `PARTIAL_SALE`, `FULL_SALE`, `SPLIT`, `WASTAGE`, `RETURN`, `ADJUSTMENT`. Written today: `SPLIT`, `ADJUSTMENT`, and `PARTIAL_SALE`/`FULL_SALE` by `consumeReservation` (used by the Planned DN). `WASTAGE` and `RETURN` are not written yet (split wastage is stored on the `SPLIT` row as `wastageSqm`).

## 4. Business rules

- Every block belongs to exactly one lot; every slab to exactly one block and therefore its lot (BD-02, spec §3.1.3). Enforced by the database: composite FK `Slab(blockId, lotId) → Block(id, lotId)`.
- Block numbers are unique within a lot; slab numbers are unique globally. Slab barcode = slab number (auto `SL-YYNNNN` when not given).
- Slab SQM = `L(cm) × W(cm) / 10,000`, rounded to 4 dp (`slabSqm`). Example: 320 cm × 160 cm → 5.1200 SQM; 287.5 cm × 163.25 cm → 46,934.375 / 10,000 = 4.6934 SQM.
- Manual SQM (`sqmOverride`) needs `inventory.editSlabSqm` (spec §3.1.4).
- Blocks and slabs inherit the lot's cost per SQM.
- Whole and partial slab sales (BD-03): a sale reduces SQM only; the rest stays sellable. Over-sale blocked by bucket locks.
- **C3 (implemented proposal):** a physical cut is a **Split**: the parent becomes `SPLIT`; each piece becomes a new slab in the same block/lot with its own dimensions, SQM and barcode (`parentSlabId`); parent SQM not covered by pieces is cutting wastage.
- A reserved slab cannot be cut; release the reservation first. `SPLIT`, `SOLD`, `DAMAGED`, `REJECTED` slabs cannot be cut.

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| Slab product needs blocks with slabs; tile product no slabs; tile SQM at lot or block level, not both | `createLotStock` (`lots.ts`) |
| Unique block no. per lot, unique slab no., unique lot no. | `createLotStock`, `newSlabNo` |
| L, W > 0; L ≤ 2000 cm, W ≤ 1000 cm | `slabInput` schema, `slabSqm` |
| SQM override permission | `slabArea` → `assertCan("inventory.editSlabSqm")` |
| Split: pieces ≤ on-hand SQM; no reserved SQM; status allows cutting | `splitSlab` |

## 6. Database entities

Built: `Lot` (lotNo, source, totalSqm, landedCostTotal, costPerSqm, PO/GRN links), `Block`, `Slab` (lengthCm, widthCm, thicknessMm, totalSqm, shade, status, parentSlabId), `SlabOperation`, `LotCostHistory`, `StockBalance`.

## 7. Accounting impact

- Lot creation: see [Inventory](inventory.md) (opening: Dr `INVENTORY` / Cr `OPENING_BALANCE_EQUITY`; GRN: Dr `INVENTORY` / Cr `GRNI`).
- Split: the net change (wastage value plus any rounding between parent and pieces) posts Dr `INVENTORY_WASTAGE` / Cr `INVENTORY`, sourceType `SLAB_SPLIT`.

## 8. Inventory impact

Split writes `SPLIT_OUT` (parent, −pieces SQM), `WASTAGE` (parent, −wastage SQM, reason "Cutting wastage"), and `SPLIT_IN` per child. Opening/GRN write `OPENING`/`GRN` per bucket.

## 9. Permissions

`inventory.openingStock` (Owner, Manager, Storekeeper), `purchase.receive` for GRN lots (Owner, Manager, Storekeeper), `inventory.split` (Owner, Manager, Storekeeper), `inventory.editSlabSqm` (Owner, Manager).

## 10. Audit requirements

Audited: lot `create` (opening; GRN audits the `GoodsReceipt`), slab `split` with pieces, childSum and wastage. Slab history (spec §3.1.3: GRN, reservations, sales, cuts, returns) is shown from movements and slab operations on `/inventory/slabs/[id]`.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Hierarchy with DB-level integrity | Done | `schema.prisma` composite FK |
| Lot tree (lot → blocks → slabs) | Done | `/inventory/lots/[id]`, `queries.getLotTree` |
| Slab list and detail with history | Done | `/inventory/slabs`, `/inventory/slabs/[id]`, `queries.getSlabDetail` |
| Lot/slab entry editor | Done | `components/lot-editor.tsx` (opening stock and GRN) |
| Slab split | Done | `/inventory/slabs/[id]` split form → `splitSlab` |
| Partial/full sale records | Partial | `consumeReservation` writes them; no sales document calls it yet (Step 6) |
| Barcode label print | Planned | — |
| Moving a slab between blocks | Not built (spec forbids cross-lot moves; DB FK blocks it) | — |

## 12. Known gaps

- No barcode label printing (spec §3.1.4 💡).
- `RETURNED` status and `RETURN` operations wait for Step 7.

## 13. Pending decisions

- C3: implemented proposal, awaiting client confirmation (DECISIONS.md §2).

## 14. Relevant tests

`erp/tests/inventory.test.ts`: "is L × W / 10,000 rounded to 4 dp"; "creates the hierarchy, stock buckets, movements and a balanced GL entry"; "refuses a slab whose lot does not match its block's lot (database FK)"; "rejects slab products without blocks/slabs and tiles with slabs"; "supports tiles at lot level and per block"; "only lets permitted roles override slab SQM"; "partial sale leaves the rest available; full sale empties the slab"; "splits a slab into pieces, records wastage and posts it to GL"; "refuses to cut a reserved slab or cut more than it holds".

Related: [Inventory](inventory.md) · [Stock reservations](stock-reservations.md) · [Opening balances](opening-balances.md) · [Purchasing](purchasing.md) · [Inventory engine](../architecture/inventory-engine.md) · [Decisions](../../DECISIONS.md)
