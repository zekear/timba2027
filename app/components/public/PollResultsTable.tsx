export interface PollResultsTableProps {
  results: Array<{ candidato: string; pct: number }>;
}

export function PollResultsTable({ results }: PollResultsTableProps) {
  const maxPct = Math.max(...results.map((r) => r.pct), 1);
  return (
    <table className="w-full">
      <tbody>
        {results.map((r) => (
          <tr key={r.candidato} className="border-b border-hairline">
            <td className="py-2 font-sans font-bold w-44 text-pageInk">{r.candidato}</td>
            <td className="py-2 w-full">
              <div className="bg-ink h-5" style={{ width: `${(r.pct / maxPct) * 100}%`, maxWidth: 400 }} />
            </td>
            <td className="py-2 font-mono font-bold text-right text-pageInk pl-2">{r.pct.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
