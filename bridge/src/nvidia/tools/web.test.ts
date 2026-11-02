import { describe, expect, it, vi } from 'vitest';
import { clearWebCache, executeWebFetch, htmlToText, isBlockedAddress } from './web.ts';

describe('web_fetch', () => {
  it('blocks loopback, private, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('refuses local URLs and other schemes without making a request', async () => {
    expect((await executeWebFetch({ url: 'http://127.0.0.1:8080/x' })).text).toContain('Refused');
    expect((await executeWebFetch({ url: 'http://[::1]/x' })).isError).toBe(true);
    expect((await executeWebFetch({ url: 'file:///etc/passwd' })).text).toContain('Only http');
    expect((await executeWebFetch({ url: 'not a url' })).isError).toBe(true);
  });
  it('serves a repeated page from the cache instead of the network', async () => {
    clearWebCache();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<p>hello</p>', { headers: { 'content-type': 'text/html' } }));
    // a public literal IP keeps the test off DNS
    const a = await executeWebFetch({ url: 'http://93.184.216.34/page' });
    const b = await executeWebFetch({ url: 'http://93.184.216.34/page' });
    expect(a.text).toContain('hello');
    expect(b).toBe(a);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it('does not cache failures', async () => {
    clearWebCache();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('no', { status: 500 }));
    await executeWebFetch({ url: 'http://93.184.216.34/bad' });
    await executeWebFetch({ url: 'http://93.184.216.34/bad' });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it('turns HTML into readable text without scripts', () => {
    const t = htmlToText('<html><head><title>x</title></head><body><script>evil()</script><h1>Hi</h1><p>a &amp; b</p><ul><li>one</li><li>two</li></ul></body></html>');
    expect(t).toBe('Hi\na & b\none\ntwo');
  });
});
