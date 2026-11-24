CREATE TABLE IF NOT EXISTS reunion_tracker (
  member INTEGER PRIMARY KEY REFERENCES roster(id),
  status TEXT NOT NULL CHECK(status IN ('attending','declined','unknown')),
  spouse INTEGER CHECK(spouse IN (0,1)),
  children INTEGER CHECK(children BETWEEN 0 AND 20),
  both_nights INTEGER CHECK(both_nights IN (0,1))
);

CREATE TABLE IF NOT EXISTS reunion_logistics (
  member INTEGER PRIMARY KEY REFERENCES roster(id),
  details TEXT NOT NULL CHECK(json_valid(details)),
  updated INTEGER NOT NULL
);
