import { describe, expect, it, vi } from 'vitest'
import { NeteaseProvider } from '../../src/main/provider'
import { createFixtureApi } from '../../src/main/test-fixtures'
import { neteaseError } from '../../src/main/netease-errors'
const user={id:'42',nickname:'测试听众',avatarUrl:''}
const cookie='MUSIC_U=fixture; __csrf=fixture-csrf'
describe('collection writes and session integrity',()=>{
  it('keeps validation cookies and rotates authenticated credentials only in the active account',async()=>{
    const api=createFixtureApi(),onCredentials=vi.fn(),provider=new NeteaseProvider(api,{onCredentials})
    expect((await provider.validateSession('MUSIC_U=fixture')).cookie).toContain('__csrf=fixture-csrf')
    provider.setSession(cookie,user)
    api.cloudsearch=async()=>({body:{code:200,result:{}},cookie:['__csrf=new-csrf; Path=/; HttpOnly']})
    await provider.search('test','song',0)
    expect(onCredentials).toHaveBeenCalledWith('MUSIC_U=fixture; __csrf=new-csrf',user)
  })
  it('ignores cookie updates from a request belonging to a logged-out session',async()=>{
    const api=createFixtureApi(),onCredentials=vi.fn();let finish!:(r:any)=>void
    api.album=()=>new Promise(resolve=>{finish=resolve})
    const provider=new NeteaseProvider(api,{onCredentials});provider.setSession(cookie,user)
    const request=provider.request('album',{id:'201'});provider.setSession('',null)
    finish({body:{code:200},cookie:['MUSIC_U=obsolete; Path=/']});await request
    expect(onCredentials).not.toHaveBeenCalled()
  })
  it.each(['album','playlist'] as const)('confirms %s collection changes and avoids duplicate writes',async kind=>{
    const api=createFixtureApi(),original=api.api;api.api=vi.fn(original);api.album_sub=vi.fn(api.album_sub)
    const provider=new NeteaseProvider(api,{wait:async()=>{}});provider.setSession(cookie,user)
    expect(await provider.subscribe(kind,'201',true)).toEqual({subscribed:true,confirmed:true})
    expect(await provider.subscribe(kind,'201',true)).toEqual({subscribed:true,confirmed:true})
    if(kind==='album')expect(api.album_sub).toHaveBeenCalledTimes(1)
    else expect(vi.mocked(api.api).mock.calls.filter(([p])=>p.uri==='/api/playlist/subscribe')).toHaveLength(1)
    expect(await provider.subscribe(kind,'201',false)).toEqual({subscribed:false,confirmed:true})
  })
  it('coalesces rapid clicks while preserving one underlying write',async()=>{
    const api=createFixtureApi();api.album_sub=vi.fn(api.album_sub)
    const provider=new NeteaseProvider(api);provider.setSession(cookie,user)
    const [a,b]=await Promise.all([provider.subscribe('album','201',true),provider.subscribe('album','201',true)])
    expect(a).toEqual(b);expect(api.album_sub).toHaveBeenCalledTimes(1)
  })
  it('does not repeat a write when the response is lost but the server already applied it',async()=>{
    const api=createFixtureApi(),original=api.album_sub
    api.album_sub=vi.fn(async p=>{await original(p);throw {body:{code:502,msg:'ECONNRESET'}}})
    const provider=new NeteaseProvider(api,{wait:async()=>{}});provider.setSession(cookie,user)
    expect(await provider.subscribe('album','201',true)).toEqual({subscribed:true,confirmed:true})
    expect(api.album_sub).toHaveBeenCalledTimes(1)
  })
  it('reports an unknown result without pretending the collection succeeded',async()=>{
    const api=createFixtureApi();api.album_sub=vi.fn(async()=>{throw {body:{code:502}}})
    const provider=new NeteaseProvider(api,{wait:async()=>{}});provider.setSession(cookie,user)
    expect(await provider.subscribe('album','201',true)).toEqual({subscribed:null,confirmed:false})
    expect(await provider.subscribe('album','201',true)).toEqual({subscribed:null,confirmed:false})
    expect(api.album_sub).toHaveBeenCalledTimes(1)
    expect(await provider.subscription('album','201')).toEqual({subscribed:false,confirmed:true})
    await provider.subscribe('album','201',true)
    expect(api.album_sub).toHaveBeenCalledTimes(2)
  })
  it('does not write when the server omits the current collection state',async()=>{
    const api=createFixtureApi();api.album_detail_dynamic=async()=>({body:{code:200}});api.album_sub=vi.fn(api.album_sub)
    const provider=new NeteaseProvider(api);provider.setSession(cookie,user)
    await expect(provider.subscribe('album','201',true)).rejects.toMatchObject({code:'STATE_UNKNOWN'})
    expect(api.album_sub).not.toHaveBeenCalled()
  })
  it('distinguishes refusals and never records a raw credential or personal response',async()=>{
    const api=createFixtureApi();api.album_sub=vi.fn(async()=>{throw {body:{code:403,message:'denied MUSIC_U=secret'}}})
    const provider=new NeteaseProvider(api);provider.setSession(cookie,user)
    await expect(provider.subscribe('album','201',true)).rejects.toMatchObject({code:'ACCESS_DENIED',upstreamCode:403})
    expect(api.album_sub).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(provider.diagnostics())).not.toMatch(/secret|fixture|MUSIC_U|__csrf/)
    expect(neteaseError({body:{code:512,message:'业务错误'}}).code).toBe('UPSTREAM')
    expect(neteaseError({body:{code:403,message:'csrf error'}}).code).toBe('AUTH_INCOMPLETE')
    expect(neteaseError({body:{code:429}}).code).toBe('RATE_LIMITED')
  })
  it('blocks writes if the verified session has no CSRF field',async()=>{
    const api=createFixtureApi();api.login_status=async()=>({body:{code:200,data:{profile:{userId:42}}}});api.album_sub=vi.fn(api.album_sub)
    const provider=new NeteaseProvider(api);provider.setSession('MUSIC_U=fixture',user)
    await expect(provider.subscribe('album','201',true)).rejects.toMatchObject({code:'AUTH_INCOMPLETE'})
    expect(api.album_sub).not.toHaveBeenCalled();expect(provider.diagnostics()).toHaveLength(1)
  })
  it('adds to an owned playlist, handles duplicates, and refuses foreign lists',async()=>{
    const provider=new NeteaseProvider(createFixtureApi());provider.setSession(cookie,user)
    expect((await provider.writablePlaylists(0)).collections.map(p=>p.id)).toEqual(['102'])
    expect(await provider.addToPlaylist('102','1001')).toEqual({alreadyPresent:false})
    expect(await provider.addToPlaylist('102','1001')).toEqual({alreadyPresent:true})
    await expect(provider.addToPlaylist('101','1002')).rejects.toMatchObject({code:'FORBIDDEN'})
  })
})
