'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';

export interface ChartPoint {
  date: string;             // ISO date
  [candidate: string]: string | number;
}

export interface MarketChartProps {
  data: ChartPoint[];
  candidates: string[];     // names que figuran en data
}

const COLORS = ['#000000', '#057dbc', '#757575', '#1a1a1a', '#a0a0a0'];

export function MarketChart({ data, candidates }: MarketChartProps) {
  return (
    <div className="w-full" style={{ height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontFamily: 'monospace', fontSize: 11, fill: '#757575' }}
            tickFormatter={(s: string) => s.slice(5)}
          />
          <YAxis
            tick={{ fontFamily: 'monospace', fontSize: 11, fill: '#757575' }}
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              border: '2px solid #000',
              borderRadius: 0,
              background: '#fff',
              fontFamily: 'sans-serif',
              fontSize: 13,
            }}
            formatter={(v) => [`${Number(v).toFixed(1)}%`, '']}
          />
          <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase' }} />
          {candidates.slice(0, 5).map((c, i) => (
            <Line
              key={c}
              type="monotone"
              dataKey={c}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={i === 0 ? 3 : 2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
