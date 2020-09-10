/**
 * Entity validator
 * Module that will validate input data for entity creation or edition
 */
'use strict';

const _ = require('lodash');

const { yup, formatYupErrors } = require('strapi-utils');
const validators = require('./validators');

const isMedia = attr => {
  return (attr.collection || attr.model) === 'file' && attr.plugin === 'upload';
};

const isSimpleAttribute = attr =>
  !attr.collection && !attr.model && attr.type !== 'component' && attr.model !== 'dynamiczone';

const createAttributeValidator = createOrUpdate => (attr, data, { isDraft }) => {
  // simple attribute
  if (isSimpleAttribute(attr)) {
    return validators[attr.type](attr, { isDraft });
  } else {
    const attributeModels = strapi.db.getModelsByAttribute(attr);
    if (attributeModels.length === 0) {
      throw new Error('Validation failed: Model not found');
    }
    // component
    if (attr.type === 'component') {
      if (_.get(attr, 'repeatable', false) === true) {
        return yup.array.of(createModelValidator(attributeModels[0], data, { isDraft }));
      } else {
        return createModelValidator(createOrUpdate)(attributeModels[0], data, { isDraft });
      }
    }
    // dynamiczone
    if (attr.type === 'dynamiczone') {
      return yup
        .array()
        .of(
          yup.object().shape({
            __component: yup
              .string()
              .required()
              .oneOf(_.keys(strapi.components)),
          })
        )
        .concat(
          yup.array().of(
            yup.lazy(item => {
              const model = strapi.getModel(item.__component);
              return createModelValidator(model, data, { isDraft });
            })
          )
        );
    }
    // relation
    if (Array.isArray(data)) {
      yup.array().of(yup.strapiID());
    } else {
      return yup.strapiID();
    }
  }
};

const createModelValidator = createOrUpdate => (model, data, { isDraft }) =>
  yup
    .object(
      _.mapValues(model.attributes, (attr, attrName) => {
        if (isMedia(attr)) {
          return yup.mixed().nullable();
        }

        let validator = createAttributeValidator(createOrUpdate)(attr, data[attrName], {
          isDraft,
        }).nullable();

        if (createOrUpdate === 'creation' && _.has(attr, 'default')) {
          validator = validator.default(attr.default);
        }

        if (!isDraft && attr.required) {
          if (createOrUpdate === 'creation') {
            validator = validator.notNil();
          } else if (createOrUpdate === 'update') {
            validator = validator.notNull();
          }
        }

        return validator;
      })
    )
    .required();

const createValidateEntity = createOrUpdate => (model, data, { isDraft = false } = {}) => {
  const validator = createModelValidator(createOrUpdate)(model, data, { isDraft });

  return validator.validate(data, { abortEarly: false }).catch(error => {
    throw strapi.errors.badRequest('ValidationError', { errors: formatYupErrors(error) });
  });
};

module.exports = {
  validateEntityCreation: createValidateEntity('creation'),
  validateEntityUpdate: createValidateEntity('update'),
};
