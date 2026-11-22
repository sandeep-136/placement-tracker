CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT,
  url TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'assessment', 'interview', 'offer', 'rejected', 'archived')),
  stipend TEXT,
  applied_date DATE NOT NULL DEFAULT CURRENT_DATE,
  deadline DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_history (
  id BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_deadline ON applications(deadline);
CREATE INDEX IF NOT EXISTS idx_status_history_app ON status_history(application_id);
