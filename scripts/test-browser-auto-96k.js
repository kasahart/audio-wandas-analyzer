const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function auditAuto96k({browser,origin,root,compare}) {
    const rate=96000, frames=16*rate, bytes=Buffer.alloc(44+frames*2);
    bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
    bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
    bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
    bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
    for(let i=0;i<frames;i++) bytes.writeInt16LE(Math.round(12000*Math.sin(2*Math.PI*500*i/rate)),44+i*2);
    const fixture=path.join(root,'test-results/generated-auto-96k.wav');fs.writeFileSync(fixture,bytes);
    const native=spawnSync(path.join(root,'.venv/bin/python'),['-c',[
        'import sys,json', 'sys.path.insert(0,"python-backend")',
        'from analysis_engine import AnalysisEngine', 'from analysis_service import AnalysisService',
        'service=AnalysisService(AnalysisEngine())',
        'label=service.engine.get_file(sys.argv[1]).frame.labels[0]',
        'profile={"schemaVersion":1,"channels":[{"channelIndex":0,"expectedLabel":label,"status":"calibrated","source":"manual","factor":10,"unit":"Pa","referenceValue":2e-5}]}',
        'print(json.dumps({"plain":service.track_detail(sys.argv[1]),"calibrated":service.track_detail(sys.argv[1],calibration_profile=profile),"profile":profile},allow_nan=False))',
    ].join('\n'),fixture],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,MPLBACKEND:'Agg'}});
    assert.equal(native.status,0,native.stderr);
    const page=await browser.newPage();
    try {
        await page.goto(origin+'/analyzer/');
        await page.evaluate(()=>{window.__auto96k=[];window.__AWA_HOST__.onMessage(m=>window.__auto96k.push(m));});
        await page.getByLabel('Open File',{exact:true}).setInputFiles(fixture);
        await page.locator('span[role="status"]').filter({hasText:'waveform ready'}).waitFor({timeout:120000});
        await page.locator('[data-action="content-spectrogram"]').click();
        await page.waitForFunction(()=>window.__auto96k.some(m=>m.type==='track-detail-result'||m.type==='track-detail-error'),undefined,{timeout:120000});
        const result=await page.evaluate(()=>window.__auto96k.find(m=>m.type==='track-detail-result'||m.type==='track-detail-error'));
        assert.equal(result.type,'track-detail-result',result.error);
        assert.equal(result.channels[0].spectrogram.hopSize,2134);
        compare(JSON.parse(native.stdout).plain.channels,result.channels,'auto96k.native/Pyodide');
        assert.equal(await page.locator('audio').evaluateAll(xs=>xs.every(x=>x.paused)),true);
        await page.locator('[data-action="browser-clear"]').click();
        const expected=JSON.parse(native.stdout);
        await page.route('**/auto-96k-fixture.wav',route=>route.fulfill({body:bytes,contentType:'audio/wav'}));
        const calibrated=await page.evaluate(async profile=>{
            const worker=new Worker('./audio.worker.js',{type:'module'});
            let id=0;
            const run=command=>new Promise((resolve,reject)=>{
                worker.onmessage=({data})=>data.error?reject(new Error(data.error.message)):resolve(data.result);
                worker.onerror=e=>reject(new Error(e.message));
                worker.postMessage({...command,requestId:String(++id)});
            });
            try {
                const bytes=await (await fetch('./auto-96k-fixture.wav')).arrayBuffer();
                await run({cmd:'load',sourceId:'calibrated.wav',bytes});
                return await run({cmd:'track-detail',filePath:'/sources/calibrated.wav',trackIndex:0,analysisId:'calibrated',settingsSignature:'auto',calibrationProfile:profile});
            } finally {worker.terminate();}
        },expected.profile);
        compare(expected.calibrated.channels,calibrated.channels,'auto96k.calibrated.native/Pyodide');
        console.log('Calibrated sparse auto-STFT native/Pyodide levels passed (factor 10, Pa, ref 20 µPa).');
        console.log('16-second 96kHz mono auto-STFT native/Pyodide parity passed; input/memory limits retained.');
    } finally {await page.close();fs.rmSync(fixture,{force:true});}
};
