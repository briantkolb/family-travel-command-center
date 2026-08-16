export function validDemoAssignment(
  slot,
  person,
  travelerNames,
  profileSlots = [1, 2, 3, 4],
) {
  return (
    Number.isInteger(slot) &&
    profileSlots.includes(slot) &&
    (person === "" || travelerNames.includes(person))
  );
}
