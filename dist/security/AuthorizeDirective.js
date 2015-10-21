var SecurityService_1 = require('./SecurityService');
/*@ngInject*/
function AuthorizeDirective($security) {
    return {
        restrict: 'A',
        link: function (scope, element, attrs) {
            var makeVisible = function () {
                element.removeClass('hidden');
            };
            var makeHidden = function () {
                element.addClass('hidden');
            };
            var makeDisabled = function () {
                element.attr('ng-disabled', 'true');
            };
            var makeEnabled = function () {
                element.removeAttr('disabled');
            };
            var roles = attrs.authorize.split(',');
            var type = attrs.authorizeAction || 'show';
            if (roles.length > 0) {
                var result;
                result = $security.authorize(roles, true, SecurityService_1.PermissionCheckType[attrs.authorizeType]);
                if (result === SecurityService_1.AccessStatus.Authorised) {
                    type === 'show' ? makeVisible() : makeEnabled();
                }
                else {
                    type === 'show' ? makeHidden() : makeDisabled();
                }
            }
        }
    };
}
AuthorizeDirective.$inject = ["$security"];
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AuthorizeDirective;
