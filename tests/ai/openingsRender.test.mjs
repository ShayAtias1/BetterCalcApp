import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {PLAN_A} from '../takeoff/fixtures.ts';
Object.assign(globalThis,{DOMMatrix:class{},DOMPoint:class{},DOMRect:class{},Path2D:class{}});
registerHooks({
 resolve(specifier,context,next){try{return next(specifier,context);}catch(e){if(specifier.startsWith('.')){try{return next(specifier+'.tsx',context);}catch{}}throw e;}},
 load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8').replace(/import \{ useAppStore \} from [^;]+;/, 'const useAppStore = Object.assign(selector => selector(globalThis.openingsRenderApp), { getState: () => globalThis.openingsRenderApp });').replace(/import \{([^}]*?)useOpeningsAiUi([^}]*?)\} from ([^;]+);/, 'import {$1useOpeningsAiUi as ignoredUiHook$2} from $3; const useOpeningsAiUi = () => globalThis.openingsRenderUi;'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};const value=next(url,context);if(value.source===null&&url.startsWith('file:'))return {...value,source:readFileSync(new URL(url))};return value;}
});
const {useAppStore}=await import('../../src/store/appStore.ts');
const {useOpeningsAiUi}=await import('../../src/lib/ai/openingsUi.ts');
useAppStore.getInitialState=useAppStore.getState;
useOpeningsAiUi.getInitialState=useOpeningsAiUi.getState;
const {default:Panel}=await import('../../src/components/AiOpeningsPanel.tsx');
const {default:Overlay}=await import('../../src/components/OpeningsOverlay.tsx');
test('Hebrew detection control is disabled for saved results; uncertain markers render and respect source binding',()=>{
 const hash='a'.repeat(64),p=structuredClone(PLAN_A);
 p.openings=[{id:'deferred',planId:p.id,pageNumber:1,geometry:null,kind:'unknown',mechanism:'unknown',walkableAccess:'unknown',source:'import',roomIds:[],legacyRefs:[],widthM:null,heightM:null,sillHeightM:null,quantity:null,approval:{status:'draft',reviewedAt:null},createdAt:1,updatedAt:1,aiDetection:{sourceHash:hash,reviewKey:'review',bbox:{x1:10,y1:10,x2:30,y2:40}}}];
 useAppStore.getState().setProject(p);useOpeningsAiUi.setState({sourceHash:hash,planId:p.id,pageNumber:1,jobs:[{planId:p.id,pageNumber:1,sourceHash:hash,status:'COMPLETED'}]});
 globalThis.openingsRenderApp=useAppStore.getState();globalThis.openingsRenderUi=useOpeningsAiUi.getState();
 const button=renderToStaticMarkup(createElement(Panel));assert.ok(button.includes('זיהוי דלתות וחלונות באמצעות AI'));assert.ok(button.includes('disabled'));
 const render=()=>renderToStaticMarkup(createElement(Overlay,{zoom:2,screenToNative:()=>({x:0,y:0}),hoverPoint:null,editable:true,isPanGesture:()=>false}));
 assert.ok(render().includes('<rect'));assert.ok(render().includes('>?</text>'));
 useOpeningsAiUi.setState({sourceHash:'b'.repeat(64)});globalThis.openingsRenderUi=useOpeningsAiUi.getState();assert.ok(!render().includes('data-opening-id'));
 useAppStore.getState().setProject(null);
});
