import { describe, it, expect } from 'vitest';
import { estimateFare, haversineKm, STATUS_META } from '@/lib/booking';
import { cancellationQuote, canCancel } from '@/lib/cancellation';
import { computeLoadingTimer } from '@/lib/loading-timer';
import { invoiceNumber } from '@/lib/invoice';

describe('fare', () => {
  it('ace 10km', () => expect(estimateFare('tata_ace', 10)).toBe(370));
  it('zero distance', () => expect(estimateFare('tata_ace', 0)).toBe(0));
  it('NaN distance', () => expect(estimateFare('tata_ace', NaN)).toBe(0));
});
describe('status meta', () => {
  it('covers every booking status', () => {
    for (const s of ['pending','accepted','in_progress','completed','cancelled','expired']) {
      expect(STATUS_META[s], s).toBeTruthy();
    }
  });
});
describe('cancellation', () => {
  it('pending free', () => expect(cancellationQuote('pending', 500).fee).toBe(0));
  it('accepted after 10min', () => expect(cancellationQuote('accepted', 500, new Date(Date.now()-600000).toISOString()).fee).toBe(50));
  it('accepted low fare min 25', () => expect(cancellationQuote('accepted', 100, new Date(Date.now()-600000).toISOString()).fee).toBe(25));
  it('in_progress 25pct', () => expect(cancellationQuote('in_progress', 400).fee).toBe(100));
  it('expired not cancellable', () => expect(canCancel('expired')).toBe(false));
});
describe('loading timer', () => {
  it('null when unstarted', () => expect(computeLoadingTimer('tata_ace', null)).toBeNull();
  );
  it('overtime charge', () => {
    const s = computeLoadingTimer('tata_407', new Date(Date.now()-65*60000).toISOString())!;
    expect(s.overtimeMinutes).toBe(5); expect(s.overtimeCharge).toBe(10);
  });
  it('invalid date', () => expect(computeLoadingTimer('tata_ace', 'not-a-date')).toBeNull());
});
describe('invoice', () => {
  it('number format', () => expect(invoiceNumber('abcdef12-1111-2222-3333-444444444444','2026-01-05T00:00:00Z')).toMatch(/^MP\/2026\d\d\/ABCDEF12$/));
});
