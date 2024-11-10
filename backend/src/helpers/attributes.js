const optionsToAttributesCreateQuery = ({ id, skills, statistics }) => {
  const stringedSkills = JSON.stringify(skills);
  const stringedStats = JSON.stringify(statistics);
  return `INSERT INTO Attributes (id, statistics, skills)
      VALUES (
        ${id},
        ${stringedSkills},
        ${stringedStats},
      )`;
};

const objectToStringList = (skills) => {
  const keys = Object.keys(skills);
  return keys.map((key) => `'${key}', ${skills[key]}`).join(", ");
};

const skillsAndStatsToQuery = (skillsList, statsList) => {
  const hasSkills = skillsList.length;
  const hasStats = statsList.length;
  const skillQuery = hasSkills
    ? `skills = skills || jsonb_build_object(${skillsList})::jsonb`
    : "";
  const comma = hasSkills && hasStats ? "," : "";
  const statsQuery = hasStats
    ? `statistics = statistics || jsonb_build_object(${statsList})`
    : "";
  return `${skillQuery}${comma}${statsQuery}`;
};

const optionsToAttributesUpdateQuery = ({ id, skills, statistics }) => {
  const skillsList = objectToStringList(skills);
  const statsList = objectToStringList(statistics);
  const query = skillsAndStatsToQuery(skillsList, statsList);
  return `
  UPDATE attributes
    SET ${query}
    WHERE id = ${id};`;
};
