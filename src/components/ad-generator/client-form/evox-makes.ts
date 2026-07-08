// EVOX vehicle picker — years EVOX covers (newest first) + the major makes.
// If EVOX's make spelling differs for any brand, fix it here (1-line change).
export const EVOX_CURRENT_YEAR = new Date().getFullYear();
export const EVOX_YEARS = Array.from({ length: EVOX_CURRENT_YEAR + 1 - 2007 + 1 }, (_, i) => EVOX_CURRENT_YEAR + 1 - i);
export const EVOX_MAKES = [
  'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat',
  'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover',
  'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'Mercedes-Benz', 'MINI', 'Mitsubishi', 'Nissan', 'Polestar',
  'Porsche', 'Ram', 'Rivian', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
];
