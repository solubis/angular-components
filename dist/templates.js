(function(module) {
try {
  module = angular.module('templates');
} catch (e) {
  module = angular.module('templates', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('demo/index.html',
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="description" content=""><meta name="viewport" content="initial-scale=1, maximum-scale=1, user-scalable=no"></head><body><test-component></test-component><script src="../../node_modules/systemjs/dist/system.js"></script><script src="system.config.js"></script><script>\n' +
    '            System.import(\'./TestComponent.ts\').catch(console.error.bind(console));\n' +
    '        </script></body></html>');
}]);
})();

(function(module) {
try {
  module = angular.module('templates');
} catch (e) {
  module = angular.module('templates', []);
}
module.run(['$templateCache', function($templateCache) {
  $templateCache.put('demo/test.html',
    '<h2>{{ctrl.title}}</h2>');
}]);
})();
