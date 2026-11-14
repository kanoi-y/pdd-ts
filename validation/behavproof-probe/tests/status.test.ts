import {defineContract,contractTest} from '@behavproof/vitest';
import {status} from '../src/status.js';
const availability=defineContract({id:'ENFORCEMENT-PROBE',intent:'An enabled probe is ready; a disabled probe is denied.',risk:'basic',cases:[{id:'enabled',input:true,expected:'ready'},{id:'disabled',negative:true,input:false,expected:'denied'}]});
contractTest.each(availability,({input})=>status(input));
