import {parentPort,workerData} from 'node:worker_threads';
import {audioClipStatistics} from './media/audio-statistics.mjs';
try{parentPort.postMessage({statistics:audioClipStatistics(workerData.source,workerData.clip,{mode:workerData.mode})});}
catch(error){parentPort.postMessage({error:{code:error.code??'STATISTICS_FAILED',message:error.message}});}
