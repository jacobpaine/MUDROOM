const descriptionAndImageIdToQuery = (description, image_id) => {};

const optionsToDescriptionsCreateQuery = ({}) => {};

const optionsToDescriptionUpdateQuery = ({ id, description, image_id }) => {
  const query = skillsAndStatsToQuery(skillsList, statsList);
  return `UPDATE attributes
    SET
      ${query}
    WHERE id = ${id};`;
};

module.exports = { optionsToDescriptionUpdateQuery };
