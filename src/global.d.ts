/// <reference types="vite/client" />
import type { HarborAPI } from '../shared';
declare global { interface Window { harbor: HarborAPI } }
