import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NodePalette } from '../components/workflow/NodePalette';
import { PropertiesPanel } from '../components/workflow/PropertiesPanel';
import { nodeTypes } from '../components/workflow/nodes';
import { getWorkflow, saveWorkflow, createWorkflow } from '../services/workflowApi';
import type { WorkflowNodeData, NodeCategory, NodeSubtype } from '../types/workflow';

import { Save, Play, Trash2, ArrowLeft, ZoomIn } from 'lucide-react';

interface WorkflowBuilderProps {
  workflowId: number | null;
  onNavigate: (screen: string) => void;
}

let nodeIdCounter = 0;
function nextId() { return `n_${Date.now()}_${++nodeIdCounter}`; }

export default function WorkflowBuilder({ workflowId, onNavigate }: WorkflowBuilderProps) {
  // Use ref so onDrop always reads the latest instance without stale closure
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  type WFNode = Node<WorkflowNodeData>;
  const [nodes, setNodes, onNodesChange] = useNodesState<WFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [selectedNode, setSelectedNode] = useState<WFNode | null>(null);
  const [wfName, setWfName] = useState('Untitled Workflow');
  const [currentId, setCurrentId] = useState<number | null>(workflowId);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (workflowId) {
      getWorkflow(workflowId).then(wf => {
        setWfName(wf.name);
        try {
          setNodes(JSON.parse(wf.nodes_json) ?? []);
          setEdges(JSON.parse(wf.edges_json) ?? []);
        } catch { /* empty canvas */ }
      }).catch(() => {});
    }
  }, [workflowId]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge({ ...connection, animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } }, eds)),
    [setEdges],
  );

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Use text/plain — WKWebView (Tauri/macOS) strips non-standard MIME types
    const raw = e.dataTransfer.getData('text/plain');
    const instance = rfInstanceRef.current;
    if (!raw || !instance) return;

    let parsed: { subtype: NodeSubtype; label: string; category: NodeCategory };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed.subtype) return; // guard against unrelated text drops

    const position = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });

    const newNode: WFNode = {
      id: nextId(),
      type: 'workflowNode',
      position,
      data: { label: parsed.label, subtype: parsed.subtype, category: parsed.category, config: {} },
    };
    setNodes(nds => [...nds, newNode]);
  }, [setNodes]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Click-to-add: places node at center of visible canvas area
  const handlePaletteAdd = useCallback((subtype: NodeSubtype, label: string, category: NodeCategory) => {
    const instance = rfInstanceRef.current;
    // Offset each new node slightly so stacked clicks don't pile up
    const offset = (nodeIdCounter % 5) * 40;
    const position = instance
      ? instance.screenToFlowPosition({ x: window.innerWidth / 2 + offset, y: window.innerHeight / 2 + offset })
      : { x: 200 + offset, y: 150 + offset };

    const newNode: WFNode = {
      id: nextId(),
      type: 'workflowNode',
      position,
      data: { label, subtype, category, config: {} },
    };
    setNodes(nds => [...nds, newNode]);
  }, [setNodes]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: WFNode) => {
    setSelectedNode(node);
  }, []);

  function handleNodeUpdate(id: string, patch: Partial<WorkflowNodeData>) {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
    setSelectedNode(prev => prev?.id === id ? { ...prev, data: { ...prev.data, ...patch } } : prev);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const nodesJson = JSON.stringify(nodes);
      const edgesJson = JSON.stringify(edges);
      if (currentId) {
        await saveWorkflow(currentId, { name: wfName, nodes_json: nodesJson, edges_json: edgesJson });
      } else {
        const wf = await createWorkflow({ name: wfName, nodes_json: nodesJson, edges_json: edgesJson });
        setCurrentId(wf.id);
      }
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg('Error saving');
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteSelected() {
    if (!selectedNode) return;
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }

  return (
    <div className="h-screen w-full bg-[#faf8f5] flex flex-col overflow-hidden">
      {/* Top toolbar */}
      <div className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
        <button
          onClick={() => onNavigate('wf-list')}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="w-px h-5 bg-slate-200" />

        <input
          value={wfName}
          onChange={e => setWfName(e.target.value)}
          className="bg-transparent text-slate-900 text-sm font-bold focus:outline-none border-b border-transparent focus:border-slate-300 px-1 w-52 transition-colors"
          placeholder="Workflow name..."
        />

        <div className="ml-auto flex items-center gap-2">
          {saveMsg && (
            <span className="text-xs text-emerald-600 font-bold">{saveMsg}</span>
          )}

          {selectedNode && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={12} /> Delete Node
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Save size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>

          <button className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors">
            <Play size={12} /> Run
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        <NodePalette onAdd={handlePaletteAdd} />

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(instance) => { rfInstanceRef.current = instance; }}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedNode(null)}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
            defaultEdgeOptions={{ animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } }}
            style={{ background: '#1e293b' }}
          >
            <Background variant={BackgroundVariant.Dots} color="#334155" gap={20} size={1} />
            <Controls
              className="!bg-white !border-slate-200 !rounded-xl overflow-hidden"
              style={{ bottom: 20, left: 20 }}
            />
            <MiniMap
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }}
              nodeColor="#3b82f6"
              maskColor="rgba(241,245,249,0.6)"
            />

            {nodes.length === 0 && (
              <Panel position="top-center" className="pointer-events-none mt-16">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-700/60 flex items-center justify-center">
                    <ZoomIn size={22} className="text-slate-400" />
                  </div>
                  <p className="text-slate-400 text-sm font-medium">Drag nodes from the left panel to get started</p>
                  <p className="text-slate-500 text-xs">Connect nodes by dragging from one handle to another</p>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        <PropertiesPanel
          node={selectedNode}
          onUpdate={handleNodeUpdate}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    </div>
  );
}
