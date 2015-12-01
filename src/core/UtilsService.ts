import {Service, Inject} from '../decorators';
import * as moment from 'moment';

const DATE_FORMAT = 'DD.MM.YYYY HH:mm:ss';

/**
 * Small utils
 */

@Service()
class UtilsService {

    constructor(
        @Inject('$filter') private $filter,
        @Inject('$dateFormat') private $dateFormat) {
    }

    /*
     Get form fields that changed, are part of model and convert them to form acceptable by server
     */
    formChanges(form, model) {
        let changes = {};

        if (!model) {
            return changes;
        }

        angular.forEach(form, (value, key) => {
            if (key[0] !== '$' && !value.$pristine) {
                if (model[key] !== undefined) {
                    changes[key] = model[key];
                }
            }
        });

        return changes;
    }

    /*
     Manually check $dirty and $valid
     when fields in sub-forms shouldn't be validated
     */
    isReadyToSave(form, exclusions) {
        let valid = true;
        let dirty = false;

        exclusions = exclusions || [];

        angular.forEach(form, (value, key) => {
            if (key[0] !== '$' && exclusions.indexOf(key) < 0) {
                if (value.$dirty) {
                    dirty = true;
                }
                valid = valid && value.$valid;
            }
        });

        return dirty && valid;
    }

    /*
     Check if object has any own properties
     */

    isEmpty(obj) {
        if (obj == null) {
            return true;
        }
        if (obj.length > 0) {
            return false;
        }
        if (obj.length === 0) {
            return true;
        }

        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                return false;
            };
        }

        return true;
    }

    /*
     Search in Array for first element (quicker than Array.prototype.filter)
     */

    arrayFilter(array, expression, flag = true) {
        let resultArray = [];

        if (this.$filter) {
            resultArray = this.$filter('filter')(array, expression, flag);
        }

        return resultArray;
    }

    arraySearch(array, expression, flag = true) {
        let result;

        if (this.$filter) {
            result = this.$filter('filter')(array, expression, flag)[0];
        }

        return result;
    }

    formatDate(date) {
        return date ? moment(date).format(this.$dateFormat) : '';
    }
}

export default UtilsService;
