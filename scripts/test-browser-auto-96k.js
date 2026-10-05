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
        'print(json.dumps(AnalysisService(AnalysisEngine()).track_detail(sys.argv[1]),allow_nan=False))',
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
        compare(JSON.parse(native.stdout).channels,result.channels,'auto96k.native/Pyodide');
        assert.equal(await page.locator('audio').evaluateAll(xs=>xs.every(x=>x.paused)),true);
        await page.locator('[data-action="browser-clear"]').click();
        console.log('16-second 96kHz mono auto-STFT native/Pyodide parity passed; input/memory limits retained.');
    } finally {await page.close();fs.rmSync(fixture,{force:true});}
};
