import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
if(process.platform!=='darwin')throw new Error('Audio Unit discovery requires macOS.');
const source=path.join(root,'native/macos/audio-units.swift'),directory=path.join(root,'.native-build');await fs.mkdir(directory,{recursive:true});
const output=path.join(directory,'newdaw-audio-units'),temporary=output+'.'+process.pid+'.tmp';
const args=['swiftc','-O','-module-cache-path',path.join(directory,'module-cache'),source,'-framework','AVFoundation','-framework','CryptoKit','-o',temporary];
const exit=await new Promise((resolve,reject)=>{const process=spawn('xcrun',args,{stdio:'inherit'});process.on('error',reject);process.on('exit',resolve);});
if(exit!==0){await fs.rm(temporary,{force:true});throw new Error('Audio Unit discovery compiler failed: '+exit);}
await fs.rename(temporary,output);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const metadata={source:'native/macos/audio-units.swift',sourceSha256:sha(await fs.readFile(source)),binarySha256:sha(await fs.readFile(output)),platform:process.platform,arch:process.arch,builtAt:new Date().toISOString(),command:['xcrun',...args]};
await fs.writeFile(output+'.json',JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify({output,...metadata},null,2));
