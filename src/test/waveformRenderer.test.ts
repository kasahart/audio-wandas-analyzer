import test from 'node:test';
import assert from 'node:assert/strict';
import { xOfNorm, buildBucketPoints } from '../panels/waveformRenderer';

test('xOfNorm maps zoomStart to 0', () => {
    assert.equal(xOfNorm(0.2, 0.2, 0.8, 800), 0);
});

test('xOfNorm maps zoomEnd to W', () => {
    assert.equal(xOfNorm(0.8, 0.2, 0.8, 800), 800);
});

test('xOfNorm maps midpoint correctly', () => {
    assert.equal(xOfNorm(0.5, 0.2, 0.8, 800), 400);
});

test('buildBucketPoints returns chronological (minFirst) order when minT < maxT', () => {
    const env = {
        min: [-0.5],
        max: [0.8],
        minT: [0.1],
        maxT: [0.3],
        absolutePeak: 0.8,
    };
    const pts = buildBucketPoints(env, 0, 0, 0, 1, 0, 1);
    assert.equal(pts[0].tNorm, 0.1);
    assert.equal(pts[0].value, -0.5);
    assert.equal(pts[1].tNorm, 0.3);
    assert.equal(pts[1].value, 0.8);
});

test('buildBucketPoints returns chronological (maxFirst) order when maxT < minT', () => {
    const env = {
        min: [-0.5],
        max: [0.8],
        minT: [0.5],
        maxT: [0.2],
        absolutePeak: 0.8,
    };
    const pts = buildBucketPoints(env, 0, 0, 0, 1, 0, 1);
    assert.equal(pts[0].tNorm, 0.2);
    assert.equal(pts[1].tNorm, 0.5);
});

test('buildBucketPoints falls back to uniform spacing when minT/maxT absent', () => {
    const env = {
        min: [-0.5, -0.3],
        max: [0.8, 0.6],
        absolutePeak: 0.8,
    } as any;
    const pts = buildBucketPoints(env, 0, 0, 0, 1, 0, 1);
    assert.ok(pts.length > 0);
});
