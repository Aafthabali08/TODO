const fs=require('fs'),vm=require('vm');let code=fs.readFileSync('src/app.js','utf8');code=code.slice(0,code.indexOf("$('#activity-form').addEventListener"));const ctx={location:{pathname:"/dashboard"},window:{dayformInitial:null},document:{querySelector:()=>({}),querySelectorAll:()=>[]},localStorage:{getItem:()=>null},crypto:require('crypto').webcrypto,console,Date};vm.createContext(ctx);vm.runInContext(code,ctx);vm.runInContext(`
state.activities=[{id:'a',category:'Sleep',date:'2026-01-01',start:'22:00',end:'07:00',repeat:'daily'}];
if(duration(state.activities[0])!==540)throw Error('Overnight duration');
if(dayAllocation('2026-10-16').Sleep!==540)throw Error('Overnight allocation');
if(Object.values(dayAllocation('2026-10-16')).reduce((a,b)=>a+b,0)!==1440)throw Error('24 hour budget');
if(!occurs({date:'2026-01-31',repeat:'monthly'},'2026-02-28'))throw Error('Monthly edge');
if(!occurs({date:'2024-02-29',repeat:'yearly'},'2025-02-28'))throw Error('Leap year');
if(occurs({date:'2026-10-16',repeat:'daily'},'2026-10-15'))throw Error('Before start');
if(!occurs({date:'2026-10-16',repeat:'weekly'},'2026-10-23'))throw Error('Weekly');
state.activities.push({id:'b',category:'Work',date:'2026-01-01',start:'23:00',end:'01:00',repeat:'daily'});
if(Object.values(dayAllocation('2026-10-16')).reduce((a,b)=>a+b,0)!==1440)throw Error('Overlap budget');
const sleep=events('2026-10-16')[0];
if(!visibleEvents('2026-10-17').some(a=>a.key===sleep.key))throw Error('Sleep carryover missing');
if(!completionError(sleep,new Date('2026-10-16T21:00'),new Date('2026-10-17T08:00').getTime()))throw Error('Early completion accepted');
if(!completionError(sleep,new Date('2026-10-17T09:00'),new Date('2026-10-17T08:00').getTime()))throw Error('Future completion accepted');
if(completionError(sleep,new Date('2026-10-17T07:00'),new Date('2026-10-17T08:00').getTime()))throw Error('Valid overnight completion rejected');
if(!completionError(sleep,new Date('2026-10-16T22:00'),new Date('2026-10-16T21:00').getTime()))throw Error('Time lock bypassed');
console.log('PASS: Sleep carryover, early/future completion rejection, valid overnight completion, time locks; Overnight duration and allocation; 24-hour budget; overlapping activities; weekly, monthly and leap-year recurrence.');`,ctx);
