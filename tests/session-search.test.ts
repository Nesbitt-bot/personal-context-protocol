import { describe, expect, it, vi, afterEach } from 'vitest';
import { searchSessions, mergeRanks } from '../src/lib/session-search';
import { keywordPattern } from '../src/lib/search-options';
import { passages } from '../search/indexer';
import { profilePicture } from '../src/lib/oidc';

afterEach(() => vi.unstubAllGlobals());
describe('private session search', () => {
  it('marks literal keywords without treating punctuation as regex or HTML', () => {
    const re = new RegExp(`(${keywordPattern('C++ [tag] c')})`, 'iu');
    expect('<b>c++</b> [TAG]'.split(re)).toEqual(['<b>', 'c++', '</b> ', '[TAG]', '']);
  });
  it('includes late transcript content and empty sessions', () => {
    const parts = passages({title:'Example',summary:'',messages:[{content:'字'.repeat(9000)+'TAIL'}]});
    expect(parts.at(-1)).toContain('TAIL');
    expect(passages({title:'Empty',summary:'',messages:[]})).toEqual(['title: Empty | text: Empty']);
  });
  it('deduplicates hits and rewards agreement between lexical and semantic ranking', () => {
    const hit = (_id: string) => ({_id});
    expect(mergeRanks([[hit('a'),hit('b')],[hit('c'),hit('b')]])).toEqual(['b','a','c']);
  });
  it('skips upstream requests for an empty visibility set', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await searchSessions('example', [])).ids).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it('filters both retrieval branches before ranking', async () => {
    const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/api/embed') ? {embeddings:[Array(768).fill(0.1)]} : {hits:{hits:[{_id:'mine'}]}}));
    vi.stubGlobal('fetch', fetch);
    expect(await searchSessions('example', ['mine'])).toEqual({ids:['mine'],semantic:true});
    const searches = (fetch.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url.endsWith('_search')).map(([,init]) => JSON.parse(String(init.body)).query);
    expect(searches[0].bool.filter).toEqual([{terms:{sid:['mine']}}]);
    expect(searches[1].nested.query.knn['passages.vector'].filter).toEqual({terms:{sid:['mine']}});
  });
  it('keeps keyword results when inference fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/api/embed') ? new Response('',{status:503}) : Response.json({hits:{hits:[{_id:'a'}]}}));
    expect(await searchSessions('hello')).toEqual({ids:['a'],semantic:false});
  });
  it('only accepts https profile pictures without embedded credentials', () => {
    expect(profilePicture('https://example.org/a')).toBe('https://example.org/a');
    for (const bad of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.org', '']) expect(profilePicture(bad)).toBeNull();
  });
});
