UPDATE public.vehicle_types SET payload_kg = COALESCE(payload_kg, weight_limit_kg) WHERE weight_limit_kg IS NOT NULL;

UPDATE public.vehicle_types SET length_ft = 6.5, width_ft = 4.5 WHERE id = 'tata_ace' AND length_ft IS NULL;
UPDATE public.vehicle_types SET length_ft = 8, width_ft = 5 WHERE id = 'pickup_8ft' AND length_ft IS NULL;
UPDATE public.vehicle_types SET length_ft = 9, width_ft = 5.5 WHERE id = 'tata_407' AND length_ft IS NULL;
UPDATE public.vehicle_types SET spec_notes = COALESCE(spec_notes, 'Rear carrier and delivery bag — small parcels and documents only.') WHERE id = 'bike_delivery';