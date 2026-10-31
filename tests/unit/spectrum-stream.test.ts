import { describe, expect, it } from 'vitest'
import { ownPlaybackInput, parsePipeWireDump } from '../../src/main/spectrum-stream'
const node = (id:number, serial:number, client:number) => ({ id, type:'PipeWire:Interface:Node', info:{props:{'media.class':'Stream/Output/Audio','object.serial':serial,'client.id':client}} })
const client = (id:number, pid:number) => ({id,type:'PipeWire:Interface:Client',info:{props:{'application.process.id':pid}}})
const stream = (id:number, serial:number) => ({index:serial,properties:{'object.id':String(id),'object.serial':String(serial)}})
describe('playback stream ownership',()=>{
  it('reads appended registry updates, escaped strings and removed nodes',()=>{
    const first=[client(118,42),node(106,1590,118),node(107,1591,118)]
    const update=[{id:107,info:null},{id:106,info:{props:{'application.name':'test ["quoted"]'}}}]
    const objects=parsePipeWireDump(`${JSON.stringify(first)}\n${JSON.stringify(update)}`)
    expect(objects).toHaveLength(2)
    expect(ownPlaybackInput([stream(106,1590)],42,objects)?.index).toBe(1590)
    expect(()=>parsePipeWireDump('[{"id":1}')).toThrow()
  })
  it('identifies a PulseAudio stream by exact process ID',()=>{
    const own={index:1,properties:{'application.process.id':'42'}}
    expect(ownPlaybackInput([{index:2,properties:{'application.process.id':'142'}},own],42)).toBe(own)
  })
  it('resolves native PipeWire ownership through the client and exact object identities',()=>{
    const own=stream(106,1590),other=stream(107,1591)
    expect(ownPlaybackInput([other,own],42,[client(118,42),client(119,99),node(106,1590,118),node(107,1591,119)])).toBe(own)
  })
  it('rejects recycled node IDs and unrelated streams even with matching application names',()=>{
    const unrelated={...stream(106,1600),properties:{...stream(106,1600).properties,'application.name':'mpv'}}
    expect(ownPlaybackInput([unrelated],42,[client(118,42),node(106,1590,118)])).toBeUndefined()
    expect(ownPlaybackInput([stream(106,1590)],42,[client(118,99),node(106,1590,118)])).toBeUndefined()
  })
})
