import { verifyPackageDir } from '../../../tools/verify/contracts-helpers.js';
import { runPackageContractSuite } from '../../../tools/verify/package-contract-suite.js';

runPackageContractSuite(verifyPackageDir());
