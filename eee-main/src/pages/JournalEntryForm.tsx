import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Trash2, CheckCircle2, AlertCircle, Save, Send,
  Loader2, Paperclip, X, FileText, Image, FileSpreadsheet, File, ChevronDown,
  RotateCcw, Clock, ArrowLeft,
} from 'lucide-react';
import { GlAccount, JournalEntryLine, JournalEntryAttachment } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { Card } from '../components/ui/Cards';
import { Badge } from '../components/ui/Cards';
import {
  getAccounts, createJournalEntry, createJeShell, updateJeDraft, updateJePosted, postJournalEntry,
  reverseJournalEntry, getJournalEntry, getEditLog, EditLogEntry,
  submitJournalEntry,
  uploadAttachment, getAttachments, deleteAttachment, getAttachmentUrl,
} from '../services/api';
import { usePermissions } from '../contexts/PermissionContext';

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

type LineState = Omit<JournalEntryLine, 'id' | 'journal_entry_id' | 'line_no'> & { _key: string };

function emptyLine(): LineState {
  return { _key: Math.random().toString(36).slice(2), gl_account_id: '', debit: 0, credit: 0, description: '' };
}

function formatBytes(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime?: string) {
  if (!mime) return <File size={16} />;
  if (mime.startsWith('image/')) return <Image size={16} />;
  if (mime.includes('pdf')) return <FileText size={16} />;
  if (mime.includes('sheet') || mime.includes('excel')) return <FileSpreadsheet size={16} />;
  return <File size={16} />;
}

// ---------------------------------------------------------------
// Searchable account combobox
// ---------------------------------------------------------------

function AccountCombobox({
  accounts,
  value,
  onChange,
}: {
  accounts: GlAccount[];
  value: number | '';
  onChange: (id: number | '') => void;
}) {
  const { t } = useTranslation('finance');
  const selected = accounts.find(a => a.id === value) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? accounts.filter(a =>
        a.account_code.toLowerCase().includes(query.toLowerCase()) ||
        a.name.toLowerCase().includes(query.toLowerCase()),
      )
    : accounts;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) { if (e.key !== 'Tab') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) { select(filtered[highlighted]); }
    } else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  function select(a: GlAccount) {
    onChange(a.id);
    setOpen(false);
    setQuery('');
    setHighlighted(0);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={cn(
          'flex items-center gap-1 rounded border bg-white transition-shadow text-sm',
          open ? 'border-blue-400 ring-1 ring-blue-400' : 'border-transparent hover:border-slate-200',
        )}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-0 px-2 py-1.5 bg-transparent focus:outline-none text-sm placeholder:text-slate-400"
          placeholder={selected ? '' : t('journalEntryForm.selectAccount')}
          value={open ? query : ''}
          onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {/* Selected label shown when closed */}
        {!open && selected && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none font-medium text-slate-800 truncate max-w-[calc(100%-3rem)]">
            <span className="font-mono text-slate-500 mr-1">{selected.account_code}</span>
            {selected.name}
          </span>
        )}
        <div className="flex items-center pr-1.5 gap-0.5 flex-shrink-0">
          {value !== '' && (
            <button type="button" onClick={clear} className="p-0.5 text-slate-300 hover:text-slate-500 rounded">
              <X size={12} />
            </button>
          )}
          <ChevronDown size={13} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} />
        </div>
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 top-full mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg text-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2.5 text-slate-400 text-xs">{t('journalEntryForm.noAccountsFound')}</li>
          ) : (
            filtered.map((a, i) => (
              <li
                key={a.id}
                onMouseDown={e => { e.preventDefault(); select(a); }}
                onMouseEnter={() => setHighlighted(i)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer',
                  i === highlighted ? 'bg-blue-600 text-white' : 'hover:bg-slate-50',
                )}
              >
                <span className={cn('font-mono text-xs w-12 flex-shrink-0', i === highlighted ? 'text-blue-100' : 'text-slate-400')}>
                  {a.account_code}
                </span>
                <span className="truncate">{a.name}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Attachment panel
// ---------------------------------------------------------------

function AttachmentPanel({
  entryId,
  attachments,
  uploading,
  onUpload,
  onDelete,
  isReadOnly,
}: {
  entryId: number | null;
  attachments: JournalEntryAttachment[];
  uploading: boolean;
  onUpload: (files: FileList) => void;
  onDelete: (a: JournalEntryAttachment) => void;
  isReadOnly?: boolean;
}) {
  const { t } = useTranslation('finance');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <Paperclip size={12} /> {t('journalEntryForm.attachmentsVouchers')}
          {attachments.length > 0 && (
            <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {attachments.length}
            </span>
          )}
        </span>
        {!isReadOnly && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {t('journalEntryForm.uploadFile')}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls"
              className="hidden"
              onChange={e => e.target.files && onUpload(e.target.files)}
            />
          </>
        )}
      </div>

      {/* Drop zone (shown when no files and not read-only) */}
      {attachments.length === 0 && !isReadOnly && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-2 transition-colors cursor-pointer',
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50/50 hover:border-blue-300 hover:bg-blue-50/30',
          )}
        >
          <Paperclip size={20} className="text-slate-300" />
          <p className="text-xs text-slate-400 font-medium text-center">
            {t('journalEntryForm.dropZoneHint')}
          </p>
        </div>
      )}

      {/* File list */}
      {attachments.length > 0 && (
        <div
          onDragOver={isReadOnly ? undefined : e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={isReadOnly ? undefined : () => setDragOver(false)}
          onDrop={isReadOnly ? undefined : handleDrop}
          className={cn(
            'rounded-lg border divide-y divide-slate-100 transition-colors',
            !isReadOnly && dragOver ? 'border-blue-300 bg-blue-50/30' : 'border-slate-200',
          )}
        >
          {attachments.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-slate-50">
              <div className="text-slate-400">{fileIcon(a.mime_type)}</div>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const url = await getAttachmentUrl(a.storage_path);
                      window.open(url, '_blank', 'noopener,noreferrer');
                    } catch {
                      alert(t('journalEntryForm.couldNotOpenFile'));
                    }
                  }}
                  className="text-sm font-medium text-blue-600 hover:underline truncate block text-left w-full"
                >
                  {a.file_name}
                </button>
                <span className="text-[10px] text-slate-400">{formatBytes(a.file_size)}</span>
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => onDelete(a)}
                  className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          {/* Add more button when files exist */}
          {!isReadOnly && (
            <div className="px-4 py-2.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {t('journalEntryForm.addMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Main form
// ---------------------------------------------------------------

export default function JournalEntryForm({
  onNavigate,
  editEntryId,
}: {
  onNavigate?: (screen: string) => void;
  editEntryId?: number;
}) {
  const { t } = useTranslation('finance');
  const { can } = usePermissions();
  const canCreate  = can('finance', 'journal_entry', 'create');
  const canEdit    = can('finance', 'journal_entry', 'edit');
  const canReverse = can('finance', 'journal_entry', 'edit');
  const isEditMode = editEntryId != null;

  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [lines, setLines] = useState<LineState[]>([emptyLine(), emptyLine()]);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [journalType, setJournalType] = useState('general');
  const [entryStatus, setEntryStatus] = useState<'draft' | 'posted' | 'reversed' | 'pending_approval' | 'rejected'>('draft');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingEntry, setLoadingEntry] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [isEditingPosted, setIsEditingPosted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(editEntryId ?? null);
  const [savedNumber, setSavedNumber] = useState<string>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [attachments, setAttachments] = useState<JournalEntryAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);

  // Load accounts
  useEffect(() => {
    getAccounts()
      .then(data => setAccounts(data.filter(a => a.is_postable && a.is_active)))
      .finally(() => setLoadingAccounts(false));
  }, []);

  // Load existing entry when in edit mode
  useEffect(() => {
    if (!editEntryId) return;
    setLoadingEntry(true);
    Promise.all([
      getJournalEntry(editEntryId),
      getAttachments(editEntryId),
      getEditLog(editEntryId),
    ]).then(([entry, atts, log]) => {
      setDescription(entry.description ?? '');
      setNotes((entry as any).notes ?? '');
      setDate(entry.entry_date);
      setJournalType(entry.journal_type ?? 'general');
      setEntryStatus(entry.status as any);
      setSavedNumber(entry.entry_number ?? '');
      if (entry.lines && entry.lines.length > 0) {
        setLines(entry.lines.map(l => ({
          _key: Math.random().toString(36).slice(2),
          gl_account_id: l.gl_account_id,
          debit: l.debit,
          credit: l.credit,
          description: l.description ?? '',
        })));
      }
      setAttachments(atts);
      setEditLog(log);
    }).catch(err => setError(err.message))
      .finally(() => setLoadingEntry(false));
  }, [editEntryId]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.0001;
  const hasAccounts = lines.every(l => l.gl_account_id !== '');

  function updateLine(key: string, field: keyof LineState, value: unknown) {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const updated = { ...l, [field]: value };
      if (field === 'debit' && Number(value) > 0) updated.credit = 0;
      if (field === 'credit' && Number(value) > 0) updated.debit = 0;
      return updated;
    }));
  }

  function buildJeNumber(id: number) {
    return `JE-${new Date(date).getFullYear()}-${String(id).padStart(6, '0')}`;
  }

  // Returns an entry_id — creates a shell (header only) if not yet saved
  async function saveOrGetId(): Promise<number> {
    if (savedId) return savedId;
    const id = await createJeShell({
      entry_date: date,
      description: description || '(draft)',
      journal_type: journalType,
      notes: notes || undefined,
    });
    setSavedId(id);
    setSavedNumber(buildJeNumber(id));
    return id;
  }

  async function handleSaveDraft() {
    setError('');
    if (!description.trim()) { setError(t('journalEntryForm.errorDescriptionRequired')); return; }
    setSaving(true);
    try {
      if (savedId) {
        // Update existing draft
        await updateJeDraft({
          entry_id: savedId,
          entry_date: date,
          description,
          journal_type: journalType,
          notes: notes || undefined,
          lines: lines.filter(l => l.gl_account_id !== '').map(({ _key, ...l }) => l),
        });
        const log = await getEditLog(savedId);
        setEditLog(log);
      } else {
        // First save — use full create if lines are ready, else shell
        const validLines = lines.filter(l => l.gl_account_id !== '');
        if (validLines.length >= 2) {
          const id = await createJournalEntry({
            entry_date: date, description, journal_type: journalType,
            notes: notes || undefined,
            lines: lines.map(({ _key, ...l }) => l),
          });
          setSavedId(id);
          setSavedNumber(buildJeNumber(id));
        } else {
          await saveOrGetId();
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePost() {
    setError('');
    if (!description.trim()) { setError(t('journalEntryForm.errorDescriptionRequired')); return; }
    if (lines.some(l => l.gl_account_id === '')) { setError(t('journalEntryForm.errorAllLinesNeedAccount')); return; }
    setPosting(true);
    try {
      let id = savedId;
      if (id) {
        // Save latest changes first, then post
        await updateJeDraft({
          entry_id: id,
          entry_date: date, description, journal_type: journalType,
          notes: notes || undefined,
          lines: lines.map(({ _key, ...l }) => l),
        });
      } else {
        id = await createJournalEntry({
          entry_date: date, description, journal_type: journalType,
          notes: notes || undefined,
          lines: lines.map(({ _key, ...l }) => l),
        });
        setSavedId(id);
        setSavedNumber(buildJeNumber(id));
      }
      await postJournalEntry(id);
      setSuccess(buildJeNumber(id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  async function handleSubmitForApproval() {
    setError('');
    if (!description.trim()) { setError(t('journalEntryForm.errorDescriptionRequired')); return; }
    if (lines.some(l => l.gl_account_id === '')) { setError(t('journalEntryForm.errorAllLinesNeedAccount')); return; }
    setSubmitting(true);
    try {
      let id = savedId;
      if (id) {
        await updateJeDraft({
          entry_id: id, entry_date: date, description, journal_type: journalType,
          notes: notes || undefined,
          lines: lines.map(({ _key, ...l }) => l),
        });
      } else {
        id = await createJournalEntry({
          entry_date: date, description, journal_type: journalType,
          notes: notes || undefined,
          lines: lines.map(({ _key, ...l }) => l),
        });
        setSavedId(id);
        setSavedNumber(buildJeNumber(id));
      }
      await submitJournalEntry(id);
      setEntryStatus('pending_approval');
      const log = await getEditLog(id);
      setEditLog(log);
      setSuccess(t('journalEntryForm.submittedForApproval', { number: buildJeNumber(id) }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverse() {
    if (!savedId) return;
    // confirm() is disabled in Tauri — proceed directly
    setReversing(true);
    setError('');
    try {
      const newId = await reverseJournalEntry(savedId);
      setSuccess(t('journalEntryForm.reversedTo', { number: `JE-${new Date(date).getFullYear()}-${String(newId).padStart(6, '0')}` }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReversing(false);
    }
  }

  async function handleSavePosted() {
    if (!savedId) return;
    setError('');
    if (!description.trim()) { setError(t('journalEntryForm.errorDescriptionRequired')); return; }
    if (lines.some(l => l.gl_account_id === '')) { setError(t('journalEntryForm.errorAllLinesNeedAccount')); return; }
    if (!isBalanced) { setError(t('journalEntryForm.errorMustBeBalanced')); return; }
    setSaving(true);
    try {
      await updateJePosted({
        entry_id: savedId,
        entry_date: date,
        description,
        journal_type: journalType,
        notes: notes || undefined,
        lines: lines.map(({ _key, ...l }) => l),
      });
      const log = await getEditLog(savedId);
      setEditLog(log);
      setIsEditingPosted(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(files: FileList) {
    setUploading(true);
    setError('');
    try {
      // Auto-save draft if not yet saved so we have an entry_id to attach to
      let entryId = savedId;
      if (!entryId) {
        if (!description.trim()) {
          setError(t('journalEntryForm.errorDescriptionBeforeUpload'));
          return;
        }
        entryId = await saveOrGetId();
      }
      for (const file of Array.from(files)) {
        const attachment = await uploadAttachment(entryId, file);
        setAttachments(prev => [...prev, attachment]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(a: JournalEntryAttachment) {
    try {
      await deleteAttachment(a);
      setAttachments(prev => prev.filter(x => x.id !== a.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Success screen
  if (success) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center space-y-6">
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-full inline-flex">
          <CheckCircle2 size={40} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900">{t('journalEntryForm.entryPosted')}</h3>
          <p className="text-sm font-mono text-slate-500 mt-1">{success}</p>
        </div>
        <div className="flex gap-4 justify-center">
          {canCreate && (
            <button
              onClick={() => {
                setSuccess(''); setSavedId(null); setSavedNumber('');
                setLines([emptyLine(), emptyLine()]);
                setDescription(''); setNotes(''); setAttachments([]);
              }}
              className="px-6 py-2 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {t('journalEntryForm.newEntry')}
            </button>
          )}
          {onNavigate && (
            <button
              onClick={() => onNavigate('je-list')}
              className="px-6 py-2 text-sm font-bold border border-slate-200 rounded hover:bg-slate-50"
            >
              {t('journalEntryForm.viewAllEntries')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loadingEntry) {
    return (
      <div className="flex items-center justify-center py-40 gap-3 text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm font-medium">{t('journalEntryForm.loadingEntry')}</span>
      </div>
    );
  }

  const isReadOnly = ((entryStatus !== 'draft' && entryStatus !== 'rejected') && !isEditingPosted) || (!isEditMode && !canCreate) || (isEditMode && !canEdit);

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          {/* Back button in edit mode */}
          {isEditMode && onNavigate && (
            <button
              onClick={() => onNavigate('je-list')}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 font-bold uppercase tracking-wide mb-2"
            >
              <ArrowLeft size={13} /> {t('journalEntryForm.backToJournalEntries')}
            </button>
          )}
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isEditMode ? (isReadOnly ? t('journalEntryForm.viewEntry') : t('journalEntryForm.editEntry')) : t('journalEntryForm.createJournalEntry')}
            </h2>
            <span className={cn(
              'px-3 py-1 rounded font-mono text-sm font-bold tracking-wider',
              savedNumber
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300',
            )}>
              {savedNumber || 'JE-YYYY-AUTO'}
            </span>
            {isEditMode && (
              <Badge type={entryStatus === 'posted' ? 'positive' : entryStatus === 'reversed' ? 'negative' : 'neutral'}>
                {entryStatus}
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
            {isReadOnly ? t('journalEntryForm.statusReadOnly', { status: entryStatus }) : savedNumber ? t('journalEntryForm.draftNotPosted') : t('journalEntryForm.numberAssignedOnSave')}
          </p>
        </div>

        {/* Balance indicator */}
        <div className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold',
          isBalanced
            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
            : 'bg-rose-50 text-rose-700 border-rose-100',
        )}>
          {isBalanced ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {isBalanced
            ? t('journalEntryForm.balanced')
            : totalDebit === 0 && totalCredit === 0
              ? t('journalEntryForm.outOfBalanceBy', { amount: '$0.00' })
              : t('journalEntryForm.outOfBalanceBy', { amount: formatCurrency(Math.abs(totalDebit - totalCredit)) })}
        </div>
      </div>

      {/* ── Editing posted warning ── */}
      {isEditingPosted && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            <span className="font-bold">{t('journalEntryForm.editingPostedTitle')}</span> {t('journalEntryForm.editingPostedDetail')}
          </p>
        </div>
      )}

      {/* ── Rejection notice ── */}
      {entryStatus === 'rejected' && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-3">
          <AlertCircle size={18} className="text-rose-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-rose-700">{t('journalEntryForm.entryRejected')}</p>
            {(editLog.find(l => l.action === 'rejected'))?.summary && (
              <p className="text-sm text-rose-600 mt-0.5">
                {(editLog.find(l => l.action === 'rejected'))!.summary!.replace('Rejected: ', '')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Entry header fields ── */}
      <Card className="p-0">
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('journalEntryForm.date')}</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('journalEntryForm.type')}</label>
              <select
                value={journalType}
                onChange={e => setJournalType(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="general">{t('journalEntryForm.typeGeneral')}</option>
                <option value="adjusting">{t('journalEntryForm.typeAdjusting')}</option>
                <option value="closing">{t('journalEntryForm.typeClosing')}</option>
                <option value="reversing">{t('journalEntryForm.typeReversing')}</option>
              </select>
            </div>
            <div className="col-span-8 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('journalEntryForm.descriptionLabel')}</label>
              <input
                type="text"
                placeholder={t('journalEntryForm.descriptionPlaceholder')}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* ── Lines table ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="px-6 py-3 w-72">{t('journalEntryForm.colAccount')}</th>
                <th className="px-6 py-3">{t('journalEntryForm.colLineDescription')}</th>
                <th className="px-6 py-3 w-36 text-right">{t('journalEntryForm.colDebit')}</th>
                <th className="px-6 py-3 w-36 text-right">{t('journalEntryForm.colCredit')}</th>
                <th className="px-6 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <tr key={line._key} className={cn('group transition-colors', isReadOnly ? 'bg-slate-50/30' : 'hover:bg-blue-50/30')}>
                  <td className="px-6 py-3">
                    {loadingAccounts ? (
                      <div className="h-8 bg-slate-100 rounded animate-pulse" />
                    ) : isReadOnly ? (
                      <span className="text-sm text-slate-700 font-medium px-2">
                        {accounts.find(a => a.id === Number(line.gl_account_id))
                          ? `${accounts.find(a => a.id === Number(line.gl_account_id))!.account_code} · ${accounts.find(a => a.id === Number(line.gl_account_id))!.name}`
                          : String(line.gl_account_id)}
                      </span>
                    ) : (
                      <AccountCombobox
                        accounts={accounts}
                        value={line.gl_account_id === '' ? '' : Number(line.gl_account_id)}
                        onChange={id => updateLine(line._key, 'gl_account_id', id === '' ? '' : id)}
                      />
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="text"
                      placeholder={t('journalEntryForm.lineDetailPlaceholder')}
                      readOnly={isReadOnly}
                      className={cn('w-full bg-transparent text-sm rounded p-1', isReadOnly ? 'text-slate-600 cursor-default' : 'focus:outline-none focus:ring-1 focus:ring-blue-500')}
                      value={line.description ?? ''}
                      onChange={e => !isReadOnly && updateLine(line._key, 'description', e.target.value)}
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      readOnly={isReadOnly}
                      className={cn('w-full bg-transparent text-sm text-right font-mono rounded p-1', isReadOnly ? 'text-slate-600 cursor-default' : 'focus:outline-none focus:ring-1 focus:ring-blue-500')}
                      value={line.debit || ''}
                      onChange={e => !isReadOnly && updateLine(line._key, 'debit', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      readOnly={isReadOnly}
                      className={cn('w-full bg-transparent text-sm text-right font-mono rounded p-1', isReadOnly ? 'text-slate-600 cursor-default' : 'focus:outline-none focus:ring-1 focus:ring-blue-500')}
                      value={line.credit || ''}
                      onChange={e => !isReadOnly && updateLine(line._key, 'credit', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() => lines.length > 2 && setLines(prev => prev.filter(l => l._key !== line._key))}
                      disabled={lines.length <= 2 || isReadOnly}
                      className="text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals row */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          {!isReadOnly && (
            <button
              onClick={() => setLines(prev => [...prev, emptyLine()])}
              className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wide"
            >
              <Plus size={16} /> {t('journalEntryForm.addLine')}
            </button>
          )}
          <div className="flex gap-12 text-right">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('journalEntryForm.totalDebit')}</p>
              <p className="text-xl font-mono font-bold text-slate-900">{formatCurrency(totalDebit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('journalEntryForm.totalCredit')}</p>
              <p className="text-xl font-mono font-bold text-slate-900">{formatCurrency(totalCredit)}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Notes + Attachments ── */}
      <div className="grid grid-cols-2 gap-5">
        {/* Notes */}
        <Card className="p-5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
            {t('journalEntryForm.notesMemo')}
          </label>
          <textarea
            rows={4}
            placeholder={t('journalEntryForm.notesPlaceholder')}
            value={notes}
            readOnly={isReadOnly}
            onChange={e => !isReadOnly && setNotes(e.target.value)}
            className={`w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none resize-none ${
              isReadOnly
                ? 'bg-slate-100 text-slate-500 cursor-default'
                : 'bg-slate-50 focus:ring-1 focus:ring-blue-500'
            }`}
          />
        </Card>

        {/* Attachments */}
        <Card className="p-5">
          <AttachmentPanel
            entryId={savedId}
            attachments={attachments}
            uploading={uploading}
            onUpload={handleUpload}
            onDelete={handleDeleteAttachment}
            isReadOnly={isReadOnly}
          />
        </Card>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-100 rounded text-sm text-rose-700 flex items-center gap-3">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          {error.toLowerCase().includes('accounting period') && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="flex-shrink-0 px-3 py-1 text-xs font-bold bg-rose-600 text-white rounded hover:bg-rose-700"
            >
              {t('journalEntryForm.goToAccountingPeriods')}
            </button>
          )}
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="flex justify-between items-center bg-white p-4 border border-slate-200 rounded-lg">
        {entryStatus === 'posted' || entryStatus === 'reversed' ? (
          /* Posted / Reversed */
          <>
            {isEditingPosted ? (
              /* Editing a posted entry */
              <>
                <button onClick={() => { setIsEditingPosted(false); setError(''); }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">
                  <X size={16} /> {t('journalEntryForm.cancel')}
                </button>
                <button onClick={handleSavePosted} disabled={saving || !isBalanced}
                  className="flex items-center gap-2 px-6 py-2.5 rounded text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {t('journalEntryForm.saveChanges')}
                </button>
              </>
            ) : (
              /* Normal posted view */
              <>
                <button onClick={() => onNavigate?.('je-list')}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">
                  <ArrowLeft size={16} /> {t('journalEntryForm.back')}
                </button>
                <div className="flex items-center gap-3">
                  {entryStatus === 'posted' && canEdit && (
                    <button onClick={() => { setIsEditingPosted(true); setError(''); }}
                      className="flex items-center gap-2 px-5 py-2.5 rounded text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200">
                      {t('journalEntryForm.editEntryBtn')}
                    </button>
                  )}
                  {entryStatus === 'posted' && canReverse && (
                    <button onClick={handleReverse} disabled={reversing}
                      className="flex items-center gap-2 px-6 py-2.5 rounded text-sm font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50">
                      {reversing ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                      {t('journalEntryForm.reverseEntry')}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        ) : entryStatus === 'pending_approval' ? (
          /* Pending — waiting for approver, staff can recall */
          <>
            <button onClick={() => onNavigate?.('je-list')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">
              <ArrowLeft size={16} /> {t('journalEntryForm.back')}
            </button>
            <span className="text-sm text-amber-600 font-semibold flex items-center gap-2">
              <Clock size={16} /> {t('journalEntryForm.awaitingApproval')}
            </span>
          </>
        ) : (
          /* Draft / Rejected — editable */
          <>
            {(canCreate || canEdit) && (
              <button onClick={handleSaveDraft} disabled={saving || submitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {t('journalEntryForm.saveDraft')}
              </button>
            )}
            {(canCreate || canEdit) && (
              <button
                onClick={handleSubmitForApproval}
                disabled={!isBalanced || !hasAccounts || submitting || saving}
                className={cn(
                  'flex items-center gap-2 px-8 py-3 rounded text-sm font-bold shadow transition-all',
                  isBalanced && hasAccounts
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                )}
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {t('journalEntryForm.submitForApproval')}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Edit / Audit log ── */}
      {editLog.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-slate-400" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('journalEntryForm.modificationHistory')}</span>
          </div>
          <ol className="relative border-l border-slate-200 space-y-4 pl-5">
            {editLog.map(log => (
              <li key={log.id} className="relative">
                <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white bg-slate-300" />
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded',
                    log.action === 'posted' ? 'bg-emerald-100 text-emerald-700'
                    : log.action === 'reversed' ? 'bg-rose-100 text-rose-700'
                    : log.action === 'created' ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600',
                  )}>
                    {log.action}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(log.changed_at).toLocaleString()}
                  </span>
                </div>
                {log.summary && (
                  <p className="text-xs text-slate-600 mt-1">{log.summary}</p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
