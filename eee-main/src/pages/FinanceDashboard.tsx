import React from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  PieChart as PieChartIcon, 
  Receipt as ReceiptIcon, 
  History,
  ChevronRight
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { MetricCard, Card, Badge } from '../components/ui/Cards';
import { formatCurrency } from '../lib/utils';

const data = [
  { name: 'MAY', revenue: 420000, expenses: 310000 },
  { name: 'JUN', revenue: 480000, expenses: 320000 },
  { name: 'JUL', revenue: 510000, expenses: 340000 },
  { name: 'AUG', revenue: 550000, expenses: 350000 },
  { name: 'SEP', revenue: 610000, expenses: 380000 },
  { name: 'OCT', revenue: 680000, expenses: 420000 },
];

const allocation = [
  { name: 'Raw Materials', value: 42, color: '#2563eb' },
  { name: 'Direct Labor', value: 28, color: '#3b82f6' },
  { name: 'Manufacturing Overhead', value: 18, color: '#60a5fa' },
  { name: 'G&A / Selling', value: 12, color: '#93c5fd' },
];

export default function FinanceDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Financial Overview</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Manufacturing Division Performance</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 text-xs font-bold bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors uppercase tracking-wide">
            Print Report
          </button>
          <button className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded shadow hover:bg-blue-700 transition-colors uppercase tracking-wide">
            Refresh Data
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <MetricCard 
          label="Total Assets" 
          value="$4,250,890.12" 
          icon={TrendingUp} 
          trend={{ value: '1.2%', isPositive: true }}
        />
        <MetricCard 
          label="Liabilities" 
          value="$1,120,450.45" 
          icon={TrendingDown} 
          trend={{ value: '0.8%', isPositive: false }}
        />
        <MetricCard 
          label="Cash Position" 
          value="$1,240,000.00" 
          icon={DollarSign} 
        />
        <MetricCard 
          label="Net Income (OCT)" 
          value="$125,000.00" 
          icon={BarChart3} 
          className="bg-blue-600 text-white"
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <Card title="Revenue vs Expenses (Rolling 6 Months)" className="col-span-8">
          <div className="h-[300px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} 
                  tickFormatter={(val) => `$${val/1000}k`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  labelStyle={{ fontWeight: 800, marginBottom: '4px' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorRev)" />
                <Area type="monotone" dataKey="expenses" stroke="#94a3b8" strokeWidth={2} fillOpacity={0.1} fill="#94a3b8" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Expense Distribution" className="col-span-4">
          <div className="space-y-6 mt-4">
            {allocation.map((item) => (
              <div key={item.name} className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-bold uppercase tracking-tight">
                  <span className="text-slate-500">{item.name}</span>
                  <span className="text-slate-900">{item.value}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-1000" 
                    style={{ width: `${item.value}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Analysis Confidence</span>
            <Badge type="positive">Very High</Badge>
          </div>
        </Card>
      </div>

      <Card title="Recent Activity" className="col-span-12">
        <div className="space-y-4">
          {[
            { id: 'JE-0941', desc: 'Raw Material Purchase - Bulk Chicken Meal', amount: 124500, status: 'Posted', date: 'Oct 24' },
            { id: 'JE-0940', desc: 'Depreciation Expense - Extruder Line 4', amount: 12800, status: 'Approved', date: 'Oct 23' },
            { id: 'JE-0939', desc: 'Accrual - Weekly Production Payroll', amount: 86400, status: 'Pending', date: 'Oct 22' },
          ].map((item) => (
            <div key={item.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 px-2 rounded -mx-2 transition-colors">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-slate-100 rounded text-slate-500">
                  <History size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{item.id}</span>
                    <Badge type={item.status === 'Posted' ? 'positive' : item.status === 'Pending' ? 'warning' : 'info'}>
                      {item.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-bold text-slate-900">{formatCurrency(item.amount)}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{item.date}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="w-full mt-4 text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center justify-center gap-1 group">
          View All Transactions
          <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </Card>
    </div>
  );
}
