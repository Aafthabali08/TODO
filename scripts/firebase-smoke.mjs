import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,createUserWithEmailAndPassword,signOut,signInWithEmailAndPassword,updateProfile,deleteUser} from 'firebase/auth';
import {getFirestore,doc,setDoc,getDoc,deleteDoc,serverTimestamp,terminate} from 'firebase/firestore';
const env=Object.fromEntries(readFileSync(new URL('../.env.local',import.meta.url),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim()]}));
const app=initializeApp({apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,appId:env.VITE_FIREBASE_APP_ID});
const auth=getAuth(app),db=getFirestore(app),email=`dayform-qa-${randomUUID()}@example.com`,password=randomBytes(24).toString('base64url');
let user,ref,failed=false;
const timeout=setTimeout(()=>{console.error('FAIL: Live Firebase check timed out. Cleanup may be required for the temporary QA account.');process.exit(1)},55000);
async function denied(label,fn){try{await fn();throw Error(label+' unexpectedly allowed')}catch(e){if(e.code==='permission-denied')console.log('PASS: '+label);else throw e}}
try{
 user=(await createUserWithEmailAndPassword(auth,email,password)).user;console.log('PASS: Email/password sign-up');
 await updateProfile(user,{displayName:'Dayform temporary QA'});console.log('PASS: Profile update');
 await signOut(auth);user=(await signInWithEmailAndPassword(auth,email,password)).user;
 if(user.displayName!=='Dayform temporary QA')throw Error('Profile did not persist');console.log('PASS: Sign-out, sign-in and profile persistence');
 ref=doc(db,'users',user.uid,'planner','state');
 const payload={activities:[{id:'qa',title:'Temporary verification activity',category:'Work',date:'2026-10-16',start:'09:00',end:'10:00',repeat:'none',notes:'QA only',link:''}],done:{},logs:[],reminders:false};
 await setDoc(ref,{payload,updatedAt:serverTimestamp()});
 if((await getDoc(ref)).data()?.payload.activities[0].title!==payload.activities[0].title)throw Error('Readback mismatch');console.log('PASS: Owner planner create and read');
 payload.done['qa@2026-10-16']='2026-10-16T10:00:00.000Z';payload.completionMeta={'qa@2026-10-16':{method:'ontime',estimated:false,recordedAt:new Date().toISOString()}};
 await setDoc(ref,{payload,updatedAt:serverTimestamp()});if(!(await getDoc(ref)).data()?.payload.done['qa@2026-10-16'])throw Error('Completion failed');console.log('PASS: Activity completion and metadata persisted');
 const foreign=doc(db,'users','qa-other-'+randomUUID(),'planner','state');
 await denied('Other-user read blocked',()=>getDoc(foreign));
 await denied('Other-user write blocked',()=>setDoc(foreign,{payload,updatedAt:serverTimestamp()}));
 await signOut(auth);await denied('Signed-out access blocked',()=>getDoc(ref));
 user=(await signInWithEmailAndPassword(auth,email,password)).user;
 await deleteDoc(ref);if((await getDoc(ref)).exists())throw Error('Delete failed');ref=null;console.log('PASS: Owner delete');
}catch(e){failed=true;console.error('FAIL:',e.code||'',e.message)}finally{
 try{if(user){if(!auth.currentUser)user=(await signInWithEmailAndPassword(auth,email,password)).user;if(ref)await deleteDoc(ref);await deleteUser(user);console.log('CLEANUP: Temporary account and planner records removed.')}}catch(e){failed=true;console.error('CLEANUP FAILED:',e.code||'',e.message)}
 clearTimeout(timeout);await terminate(db);await deleteApp(app);process.exitCode=failed?1:0;
}
