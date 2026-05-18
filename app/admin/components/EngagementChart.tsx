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
  BarChart,
  Bar,
} from 'recharts';

export interface DayPoint {
  date: string;          // 'YYYY-MM-DD'
  posts: number;
  avgLikes: number;
  avgRTs: number;
  avgImpressions: number;
  totalLikes: number;
  totalImpressions: number;
}

export function EngagementLineChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke="#757575" style={{ fontSize: 11 }} />
        <YAxis stroke="#757575" style={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="avgLikes" name="Avg likes" stroke="#000000" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="avgRTs" name="Avg RTs" stroke="#057dbc" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ImpressionsChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke="#757575" style={{ fontSize: 11 }} />
        <YAxis stroke="#757575" style={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="avgImpressions" name="Avg impressions" stroke="#000000" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PostsPerDayChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke="#757575" style={{ fontSize: 11 }} />
        <YAxis stroke="#757575" style={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="posts" name="Posts publicados" fill="#000000" />
      </BarChart>
    </ResponsiveContainer>
  );
}
