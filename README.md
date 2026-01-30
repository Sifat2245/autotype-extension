# TypeSnap

**Convert JSON to clean TypeScript types/interfaces instantly**

Paste JSON → get beautifully structured, extracted TypeScript code — automatically.

## Extension Name & Description

**Name:** TypeSnap  
**Description:**  
Paste JSON right after `type:` or `interface:` → TypeSnap automatically replaces it with clean, extracted TypeScript types or interfaces using `json-to-ts`. Supports custom names, optional fields, arrays, and nested objects.

## Features

- Zero-command auto-conversion when pasting JSON
- Triggers on `type:` or `interface:` on its own line
- Supports **custom root names** — e.g. `type UserResponse:` or `interface ApiError:`
- Nested objects extracted into separate named interfaces/types
- Proper handling of arrays, null/undefined → optional fields
- Clean spacing & consistent formatting
- Undo support (`Ctrl+Z` / `Cmd+Z`)
- Works only in `.ts` and `.tsx` files

## How to Trigger It

1. Open any `.ts` or `.tsx` file
2. On an empty line write one of the following:
3. Press `Enter`
4. Paste your JSON object or array immediately below the trigger line
5. Wait ~0.3–0.8 seconds → TypeSnap replaces the trigger line + JSON with clean TypeScript code

## Requirements

Visual Studio Code ≥ 1.70.0                   
Only works in TypeScript files (.ts, .tsx)

## Example

### Input (what you write + paste)

```json
// your-file.ts
interface:
{
  "id": 110,
  "camp_name": "Cullen Harrison",
  "camp_logo": "https://example.com/logo.png",
  "location": "Aspernatur quo et fu",
  "start_date": "2026-02-09",
  "end_date": "2026-02-11",
  "price": "220.00",
  "date_range": [
    { "day": "February 09" },
    { "day": "February 10" },
    { "day": "February 11" }
  ],
  "sport": {
    "id": 2,
    "sports_name": "Basketball",
    "icon": "https://example.com/basketball.png"
  }
}

```

## Output

```typescript
export interface CampResponse {
  id: number;
  camp_name: string;
  camp_logo: string;
  location: string;
  start_date: string;
  end_date: string;
  price: string;
  date_range: DateRange[];
  sport: Sport;
}

export interface DateRange {
  day: string;
}

export interface Sport {
  id: number;
  sports_name: string;
  icon: string;
}
```


### You can add a custom name to your type or interface. Here is an example:

```json
type ProductDto:
{
  "id": 1,
  "name": "Laptop",
  "price": 999.99,
  "tags": ["electronics", "premium"]
}
```

You will get the output

```typescript
export type ProductDto = {
  id: number;
  name: string;
  price: number;
  tags: string[];
};
```