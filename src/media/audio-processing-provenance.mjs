import{requireValue}from'./common.mjs';
const LIMIT=1024*1024;
/** A private RIFF chunk travels with the exact managed WAV in bundles/backups. */
export function appendAudioProcessingProvenance(wav,record){
 const source=Buffer.from(wav);requireValue(source.toString('ascii',0,4)==='RIFF'&&source.toString('ascii',8,12)==='WAVE','INVALID_PROCESSED_WAV','Provenance requires a RIFF WAV.');
 validate(record);const data=Buffer.from(JSON.stringify(record),'utf8');requireValue(data.length<=LIMIT,'PROVENANCE_LIMIT','Processing provenance exceeds1MiB.');const chunk=Buffer.alloc(8+data.length+(data.length%2));chunk.write('NDPR',0,'ascii');chunk.writeUInt32LE(data.length,4);data.copy(chunk,8);const result=Buffer.concat([source,chunk]);requireValue(result.length<=128*1024*1024,'PROCESSED_ASSET_LIMIT','Processed WAV exceeds128MiB.');result.writeUInt32LE(result.length-8,4);return result;
}
function validate(record){requireValue(record&&record.format==='newdaw-audio-processing'&&record.version===1&&record.operation==='timeStretch'&&record.sourceClip?.type==='audio'&&record.sourceClip.assetId===record.sourceAsset?.id&&typeof record.sourceAsset?.sha256==='string'&&/^[a-f0-9]{64}$/.test(record.sourceAsset.sha256)&&record.processing&&typeof record.processing==='object','INVALID_PROCESSING_PROVENANCE','Invalid audio processing provenance.');}
export function readAudioProcessingProvenance(input){
 const bytes=Buffer.from(input);requireValue(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','INVALID_PROCESSED_WAV','Expected RIFF WAV.');let result=null;const end=bytes.readUInt32LE(4)+8;requireValue(end<=bytes.length,'INVALID_PROCESSED_WAV','Truncated WAV.');
 for(let offset=12;offset+8<=end;){const size=bytes.readUInt32LE(offset+4),next=offset+8+size+(size%2);requireValue(next<=end,'INVALID_PROCESSED_WAV','Truncated WAV chunk.');if(bytes.toString('ascii',offset,offset+4)==='NDPR'){requireValue(result===null&&size<=LIMIT,'INVALID_PROCESSING_PROVENANCE','Ambiguous or oversized provenance.');result=JSON.parse(bytes.toString('utf8',offset+8,offset+8+size));validate(result);}offset=next;}return result;
}
