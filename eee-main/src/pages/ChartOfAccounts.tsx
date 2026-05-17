import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MoreVertical, Search, FileText, Download, Plus } from 'lucide-react';
import { Card, Badge } from '../components/ui/Cards';
import { cn, formatCurrency } from '../lib/utils';
import { Account } from '../types';

const MOCK_COA: Account[] = [
  {
    id: '1',
    code: '1000-00-000',
    name: 'ASSETS',
    type: 'Asset',
    level: 0,
    is_postable: false,
    balance: 4250890.12,
    children: [
      {
        id: '1.1',
        code: '1100-00-000',
        name: 'Current Assets',
        type: 'Asset',
        level: 1,
        is_postable: false,
        balance: 2450230.12,
        children: [
          {
            id: '1.1.1',
            code: '1110-10-100',
            name: 'Operating Cash - Chase Main',
            type: 'Asset',
            level: 2,
            is_postable: true,
            balance: 1240000.00
          },
          {
            id: '1.1.2',
            code: '1120-00-000',
            name: 'Accounts Receivable - Trade',
            type: 'Asset',
            level: 2,
            is_postable: true,
            balance: 820110.12
          }
        ]
      },
      {
        id: '1.2',
        code: '1400-00-000',
        name: 'Inventory',
        type: 'Asset',
        level: 1,
        is_postable: false,
        balance: 1800660.00,
        children: [
          {
            id: '1.2.1',
            code: '1410-10-100',
            name: 'Raw Materials - Bulk Proteins',
            type: 'Asset',
            level: 2,
            is_postable: true,
            balance: 1200000.00
          }
        ]
      }
    ]
  },
  {
    id: '2',
    code: '2000-00-000',
    name: 'LIABILITIES',
    type: 'Liability',
    level: 0,
    is_postable: false,
    balance: 1120450.45,
    children: [
      {
        id: '2.1',
        code: '2100-00-000',
        name: 'Accounts Payable',
        type: 'Liability',
        level: 1,
        is_postable: true,
        balance: 450000.00
      }
    ]
  }
];

function AccountRow({ account, depth = 0 }: { account: Account, depth?: number, key?: string }) {
  const [isOpen, setIsOpen] = useState(depth === 0);

  return (
    <>
      <tr className={cn(
        "group transition-colors",
        depth === 0 ? "bg-slate-50/50" : "hover:bg-blue-50/20"
      )}>
        <td className="px-6 py-3">
          <div className="flex items-center gap-3" style={{ paddingLeft: `${depth * 24}px` }}>
            {!account.is_postable ? (
              <button onClick={() => setIsOpen(!isOpen)} className="text-slate-400 hover:text-slate-600">
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <div className="w-4" />
            )}
            <span className={cn(
              "font-mono text-xs tracking-wider",
              !account.is_postable ? "font-bold text-slate-900" : "text-slate-500"
            )}>
              {account.code}
            </span>
          </div>
        </td>
        <td className="px-6 py-3">
          <span className={cn(
            "text-sm uppercase tracking-tight",
            !account.is_postable ? "font-bold text-slate-900" : "font-medium text-slate-700"
          )}>
            {account.name}
          </span>
        </td>
        <td className="px-6 py-3">
          <Badge type={account.is_postable ? 'info' : 'neutral'}>
            {account.is_postable ? 'Postable' : 'Roll-up'}
          </Badge>
        </td>
        <td className="px-6 py-3 text-right">
          <span className={cn(
            "font-mono text-sm",
            !account.is_postable ? "font-bold text-slate-900" : "text-slate-700"
          )}>
            {formatCurrency(account.balance)}
          </span>
        </td>
        <td className="px-6 py-3 text-center">
          <button className="text-slate-300 hover:text-slate-600 transition-colors">
            <MoreVertical size={16} />
          </button>
        </td>
      </tr>
      {isOpen && account.children?.map(child => (
        <AccountRow key={child.id} account={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Chart of Accounts</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">Configure account hierarchy and postability</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 text-xs font-bold bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors uppercase tracking-wide flex items-center gap-2">
            <Download size={14} /> Export CSV
          </button>
          <button className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded shadow hover:bg-blue-700 transition-colors uppercase tracking-wide flex items-center gap-2">
            <Plus size={14} /> Create Account
          </button>
        </div>
      </div>

      <div className="flex gap-4 items-center bg-white p-4 border border-slate-200 rounded-lg">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search accounts by name or segmented code..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded flex-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <select className="bg-white border border-slate-200 rounded px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
            <option>All Types</option>
            <option>Assets</option>
            <option>Liabilities</option>
          </select>
        </div>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                <th className="px-6 py-4 w-1/4">Account Code</th>
                <th className="px-6 py-4 w-1/3">Account Name</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Balance</th>
                <th className="px-6 py-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MOCK_COA.map(acc => (
                <AccountRow key={acc.id} account={acc} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
