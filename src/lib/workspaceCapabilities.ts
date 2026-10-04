import type { MarkupTool, MeasureTool, ToolMode } from '../types';

// Session capability only; never part of a plan or persistence schema.
let workspaceWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
let pointerType = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
export const setWorkspaceWidth = (width: number) => { workspaceWidth = width; };
export const setWorkspacePointer = (type: string) => { pointerType = type || 'mouse'; };
export const isPhoneWorkspace = () => workspaceWidth < 768;
export const isTouchInput = () => pointerType !== 'mouse';
export const canAuthorTakeoff = () => !isPhoneWorkspace();
export const canUseMeasureTool = (tool: MeasureTool | null) => !isPhoneWorkspace() || tool === null || tool === 'distance';
export const canUseMarkupTool = (tool: MarkupTool | null) => !isPhoneWorkspace() || tool === null || tool === 'text' || tool === 'arrow' || tool === 'rectangle';
export const canUseToolMode = (mode: ToolMode) => !isPhoneWorkspace() || mode === 'select' || mode === 'pan' || mode === 'measure' || mode === 'markup';
