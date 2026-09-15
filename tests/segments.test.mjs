import test from 'node:test';
import assert from 'node:assert/strict';
import {providerSegments,chapterSegments,activeSegment,validSegments,mergeSegments} from '../lib/cinema/segments.ts';
const op={kind:'opening',start:0,end:90,source:'provider'};
const ed={kind:'ending',start:1200,end:1290,source:'provider'};
test('AniLiberty markers preserve zero and fractional times, missing markers stay missing',()=>{
 assert.deepEqual(providerSegments({opening:{start:0,stop:90},ending:{start:1200,stop:1290}}),[op,ed]);
 assert.deepEqual(providerSegments({opening:{start:null,stop:null},ending:{start:0,stop:0}}),[]);
 assert.deepEqual(providerSegments({opening:{start:1.5,stop:91.5}}),[{...op,start:1.5,end:91.5}]);
 assert.deepEqual(providerSegments(null),[]);
});
test('reject malformed, reversed, out-of-stream and overlapping intervals',()=>{
 for(const start of [-1,NaN,Infinity,'0',null,true])assert.deepEqual(validSegments([{...op,start}]),[]);
 assert.deepEqual(validSegments([{...op,end:0}]),[]);
 assert.deepEqual(validSegments([op],89),[]);
 assert.deepEqual(validSegments([op,{...ed,start:80,end:150}]),[]);
 assert.deepEqual(validSegments([op,op]),[]);
});
test('prompts follow seeks and disappear at the exact end, preserving post-credit scenes',()=>{
 assert.equal(activeSegment([op,ed],0,1440),op);
 assert.equal(activeSegment([op,ed],90,1440),undefined);
 assert.equal(activeSegment([op,ed],1200,1440),ed);
 assert.equal(activeSegment([op,ed],1290,1440),undefined);
 assert.equal(activeSegment([op,ed],1400,1440),undefined);
 assert.equal(activeSegment([op],0,Infinity),undefined);
});
test('chapter fallback recognizes explicit labels and never guesses from duration',()=>{
 assert.deepEqual(chapterSegments([{title:'Opening',startTime:0,endTime:90},{title:'End Credits',startTime:1200,endTime:1290}]),[{...op,source:'chapter'},{...ed,source:'chapter'}]);
 for(const title of ['Opening scene','Chapter 1','Previously on','The end','Intro to the story'])assert.deepEqual(chapterSegments([{title,startTime:0,endTime:90}]),[]);
 assert.deepEqual(chapterSegments([]),[]);
});
test('provider markers win over chapters; unrelated fallback is retained',()=>{
 assert.deepEqual(mergeSegments([op],[{...op,end:95,source:'chapter'},{...ed,source:'chapter'}]),[op,{...ed,source:'chapter'}]);
 assert.deepEqual(mergeSegments([op],[{...ed,start:80,end:100,source:'chapter'}]),[op]);
});
