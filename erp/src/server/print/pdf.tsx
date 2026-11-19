// PDF rendering with @react-pdf/renderer (TX-01, TD-035): A4, built-in Helvetica (no external fonts or network),
// repeating table header, page numbers. Pure layout: the data comes in as a PrintDoc.
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CompanyHeader, PrintDoc } from "./types";

const ink = "#0f1b33";
const muted = "#55627a";
const line = "#dde3ec";
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontSize: 9, fontFamily: "Helvetica", color: ink },
  row: { flexDirection: "row" },
  company: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: muted },
  title: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right" },
  number: { fontSize: 10, textAlign: "right", marginTop: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: ink, marginVertical: 10 },
  blockLabel: { fontSize: 7, color: muted, textTransform: "uppercase", marginBottom: 2 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: muted, paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: ink },
  td: { paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: line },
  totals: { alignSelf: "flex-end", width: 220, marginTop: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: muted },
  sign: { flex: 1, borderTopWidth: 0.5, borderTopColor: muted, marginHorizontal: 8, paddingTop: 3, fontSize: 8, color: muted, textAlign: "center" },
});

function PrintPdf({ doc, company, printedAt }: { doc: PrintDoc; company: CompanyHeader; printedAt: string }) {
  const totalWidth = doc.columns.reduce((a, c) => a + (c.width ?? 1), 0);
  const w = (c: { width?: number }) => `${((c.width ?? 1) / totalWidth) * 100}%`;
  return (
    <Document title={`${doc.title} ${doc.number}`} author={company.name} creator="Jame Jam ERP" producer="Jame Jam ERP">
      <Page size="A4" style={s.page}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.company}>{company.name}</Text>
            {company.lines.map((l, i) => (
              <Text key={i} style={s.small}>{l}</Text>
            ))}
          </View>
          <View style={{ width: 200 }}>
            <Text style={s.title}>{doc.title}</Text>
            <Text style={s.number}>{doc.number}</Text>
            {doc.facts.map(([k, v], i) => (
              <Text key={i} style={[s.small, { textAlign: "right" }]}>{`${k}: ${v}`}</Text>
            ))}
          </View>
        </View>
        <View style={s.rule} />
        {(doc.party || doc.extra) && (
          <View style={[s.row, { marginBottom: 10 }]}>
            {[doc.party, doc.extra].map((b, i) =>
              b ? (
                <View key={i} style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.blockLabel}>{b.label}</Text>
                  {b.lines.map((l, j) => (
                    <Text key={j} style={j === 0 ? { fontFamily: "Helvetica-Bold" } : undefined}>{l}</Text>
                  ))}
                </View>
              ) : (
                <View key={i} style={{ flex: 1 }} />
              ),
            )}
          </View>
        )}
        {doc.columns.length > 0 && (
          <View>
            <View style={s.row} fixed>
              {doc.columns.map((c) => (
                <Text key={c.key} style={[s.th, { width: w(c), textAlign: c.align ?? "left" }]}>{c.label}</Text>
              ))}
            </View>
            {doc.rows.map((r, i) => (
              <View key={i} style={s.row} wrap={false}>
                {doc.columns.map((c) => (
                  <Text key={c.key} style={[s.td, { width: w(c), textAlign: c.align ?? "left" }]}>{r[c.key] ?? ""}</Text>
                ))}
              </View>
            ))}
            {doc.rows.length === 0 && <Text style={[s.td, s.small]}>No lines.</Text>}
          </View>
        )}
        {doc.totals && doc.totals.length > 0 && (
          <View style={s.totals} wrap={false}>
            {doc.totals.map(([k, v], i) => (
              <View key={i} style={[s.totalRow, i === doc.totals!.length - 1 ? { borderTopWidth: 1, borderTopColor: ink, fontFamily: "Helvetica-Bold" } : {}]}>
                <Text>{k}</Text>
                <Text>{v}</Text>
              </View>
            ))}
          </View>
        )}
        {doc.notes && doc.notes.length > 0 && (
          <View style={{ marginTop: 14 }} wrap={false}>
            {doc.notes.map((n, i) => (
              <Text key={i} style={[s.small, { marginBottom: 2 }]}>{n}</Text>
            ))}
          </View>
        )}
        {company.bank && company.bank.length > 0 && (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={s.blockLabel}>Bank details</Text>
            {company.bank.map((b, i) => (
              <Text key={i} style={s.small}>{b}</Text>
            ))}
          </View>
        )}
        {doc.signatures && doc.signatures.length > 0 && (
          <View style={[s.row, { marginTop: 40 }]} wrap={false}>
            {doc.signatures.map((x) => (
              <Text key={x} style={s.sign}>{x}</Text>
            ))}
          </View>
        )}
        <View style={s.footer} fixed>
          <Text>{`${doc.title} ${doc.number} · printed ${printedAt}`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPdf(doc: PrintDoc, company: CompanyHeader): Promise<Buffer> {
  const printedAt = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return renderToBuffer(<PrintPdf doc={doc} company={company} printedAt={printedAt} />);
}
