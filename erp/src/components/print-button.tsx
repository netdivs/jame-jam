"use client";
// Browser print (and "Save as PDF") until server-side PDF generation lands (TX-01).
import { Button } from "./ui";

export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
