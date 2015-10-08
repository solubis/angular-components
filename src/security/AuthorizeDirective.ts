/// <reference path="../../typings/tsd.d.ts" />

import { SecurityService, AccessStatus, PermissionCheckType } from './SecurityService';

interface Attributes extends ng.IAttributes {
    authorizeType: string;
    authorizeAction: string;
    authorize: string;
}

/*@ngInject*/
function AuthorizeDirective($security: SecurityService): ng.IDirective {
    return {
        restrict: 'A',
        link: (scope: ng.IScope, element: ng.IAugmentedJQuery, attrs: Attributes) => {
            let makeVisible = () => {
                element.removeClass('hidden');
            };

            let makeHidden = () => {
                element.addClass('hidden');
            };

            let makeDisabled = () => {
                element.attr('ng-disabled', 'true');
            };

            let makeEnabled = () => {
                element.removeAttr('disabled');
            };

            let roles = attrs.authorize.split(',');
            let type = attrs.authorizeAction || 'show';

            if (roles.length > 0) {
                let result: AccessStatus;

                result = $security.authorize(roles, true, PermissionCheckType[attrs.authorizeType]);

                if (result === AccessStatus.Authorised) {
                    type === 'show' ? makeVisible() : makeEnabled();
                } else {
                    type === 'show' ? makeHidden() : makeDisabled();
                }
            }
        }
    };
}

export default AuthorizeDirective;
