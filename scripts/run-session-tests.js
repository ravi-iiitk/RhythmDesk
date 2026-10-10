const { formatTestResults, runTestSuite } = require('../dist/main/core/testing/testHarness');

runTestSuite()
  .then((results) => {
    console.log(formatTestResults(results));
    if (results.failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
