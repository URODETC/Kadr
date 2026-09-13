import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackError} from '../lib/cinema/player-errors.ts';
test('recoverable segment errors do not become fatal playback errors',()=>{
 assert.equal(playbackError({severity:1,category:1,code:1002}).fatal,false);
 assert.equal(playbackError({severity:2,category:3,code:3016}).fatal,true);
});
test('source-switch cancellations are ignored and signed URLs are not shown',()=>{
 assert.equal(playbackError({severity:2,code:7000}),null);
 assert.equal(playbackError({severity:2,code:7001}),null);
 const result=playbackError({severity:2,category:1,code:1001,data:['https://cdn.test/?token=secret'],message:'secret'});
 assert.match(result.message,/1001/);
 assert.ok(!result.message.includes('secret'));
});
