export interface Test {
  id: number;
  camp_name: string;
  camp_logo: string;
  location: string;
  start_date: string;
  end_date: string;
  camp_details: string;
  price: string;
  sports_type_id: number;
  sports_type_name: string;
  status: string;
  created_at: string;
  timezone: string;
  date_range: Daterange[];
  sport: Sport;
  director: Director;
}

export interface Director {
  id: number;
  name: string;
  avatar: string;
  email: string;
  phone: null;
  address: string;
}

export interface Sport {
  id: number;
  sports_name: string;
  icon: string;
}

export interface Daterange {
  day: string;
}
