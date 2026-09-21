import { verifyPackageDir } from '../../../tools/verify/contracts-helpers.js';
import { runIsolationSuite } from '../../../tools/verify/isolation-suite.js';

runIsolationSuite(verifyPackageDir());
