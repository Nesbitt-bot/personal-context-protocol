import { describe, expect, it, vi, afterEach } from 'vitest';
import { searchSessions, mergeRanks, lexicalSessionQuery } from '../src/lib/session-search';
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
  it('shares a keyword predicate with count-only callers, including an empty ACL', () => {
    expect(lexicalSessionQuery('example', [])).toEqual({ match_none: {} });
    expect(lexicalSessionQuery('example', ['mine'])).toEqual({ bool: { filter: [{terms:{sid:['mine']}}],
      must: [{multi_match:{query:'example',fields:['title^4','summary^2','messages.content']}}] } });
  });
  it('filters both branches and counts related hits only when absent from the full lexical set', async () => {
    const allowed = ['mine', 'related', 'keyword-on-another-page'];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      if (url.endsWith('/api/embed')) return Response.json({embeddings:[Array(768).fill(0.1)]});
      if (request.query.nested) {
        expect(request.query.nested.query.knn['passages.vector'].filter).toEqual({terms:{sid:allowed}});
        return Response.json({hits:{hits:[{_id:'related'},{_id:'keyword-on-another-page'},{_id:'forbidden'}]}});
      }
      expect(request.query).toEqual(lexicalSessionQuery('example', allowed));
      expect(request.track_total_hits).toBe(true);
      expect(request.aggs.overlap.filter.terms.sid).toEqual(['related','keyword-on-another-page']);
      return Response.json({hits:{total:{value:2,relation:'eq'},hits:[{_id:'mine'}]}, aggregations:{overlap:{doc_count:1}}});
    });
    vi.stubGlobal('fetch', fetch);
    expect(await searchSessions('example', allowed)).toEqual({ids:['mine','related','keyword-on-another-page'],total:3,semantic:true});
  });
  it('keeps the full exact keyword total when inference fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/api/embed') ? new Response('',{status:503})
      : Response.json({hits:{hits:[{_id:'a'}],total:{value:10123,relation:'eq'}}}));
    expect(await searchSessions('hello')).toEqual({ids:['a'],total:10123,semantic:false});
  });
  it.each([
    { hits: { total: { relation: 'gte', value: 10000 }, hits: [] } },
    { hits: { hits: [] } },
    { hits: { total: { relation: 'eq', value: 0 }, hits: [] }, timed_out: true },
    { hits: { total: { relation: 'eq', value: 0 }, hits: [] }, _shards: { failed: 1 } },
  ])('never reports a partial or missing total as exact', async body => {
    vi.stubGlobal('fetch', async () => Response.json(body));
    await expect(searchSessions('hello', undefined, 'keyword')).rejects.toThrow();
  });
  it('only accepts https profile pictures without embedded credentials', () => {
    expect(profilePicture('https://example.org/a')).toBe('https://example.org/a');
    for (const bad of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.org', '']) expect(profilePicture(bad)).toBeNull();
  });
});
