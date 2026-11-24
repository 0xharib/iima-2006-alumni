export const outings = [
  ['','Choose an option'], ['sightseeing','Jaipur half-day sightseeing'],
  ['shopping','Jaipur shopping / bazaar'], ['hotel','Bazaar workshops at the hotel'],
  ['none','Skip the outing']
];

export function reunionDetails(f) {
  const value = name => String(f.get(name) ?? '').trim().slice(0,120);
  const choice = (name, options) => options.includes(value(name)) ? value(name) : '';
  const count = choice('children', ['0','1','2','3','4','5','6','7','8','9','10']);
  const spouse = choice('spouse',['0','1']);
  const date = name => /^\d{4}-\d{2}-\d{2}$/.test(value(name)) ? value(name) : '';
  const time = name => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value(name)) ? value(name) : '';
  return {
    shirt:value('shirt'), spouse, children:count,
    spouseName:spouse==='1'?value('spouseName'):'',
    spouseShirt:spouse==='1'?value('spouseShirt'):'',
    outing:spouse==='1'?choice('outing',outings.map(([key])=>key)):'',
    kids:Array.from({length:Number(count)},(_,i)=>({
      name:value('kidName'+i), gender:value('kidGender'+i),
      age:/^(?:\d|1[0-9]|2[0-5])$/.test(value('kidAge'+i))?value('kidAge'+i):'',
      shirt:value('kidShirt'+i),
    })),
    help:choice('help',['0','1']), bothNights:choice('bothNights',['0','1']),
    arrivalDate:date('arrivalDate'), arrivalTime:time('arrivalTime'),
    departureDate:date('departureDate'), departureTime:time('departureTime')
  };
}

export function missingReunionDetails(values) {
  const fields=[['Attendee T-shirt size',values.shirt],['Spouse attendance',values.spouse],
    ['Number of children',values.children],['Hotel stay',values.bothNights]];
  if(values.spouse==='1') fields.push(['Spouse T-shirt size',values.spouseShirt],['Sunday outing',values.outing]);
  for(let i=0;i<Number(values.children);i++){
    fields.push(['Child '+(i+1)+' age',values.kids?.[i]?.age],['Child '+(i+1)+' T-shirt size',values.kids?.[i]?.shirt]);
  }
  return fields.filter(([,value])=>value==null||String(value).trim()==='').map(([label])=>label);
}

export function reunionValues(tracker,saved) {
  const defaults = Object.fromEntries(
    Object.entries({spouse:tracker?.spouse,children:tracker?.children,bothNights:tracker?.both_nights})
      .map(([key,value])=>[key,value==null?'':String(value)])
  );
  return {...defaults,...saved};
}

export function editReunionDetail(tracker,saved,key,value) {
  const values = reunionValues(tracker,saved);
  const fields = ['shirt','spouse','children','help','bothNights','arrivalDate','arrivalTime','departureDate','departureTime'];
  if (values.spouse==='1') fields.push('spouseName','spouseShirt','outing');
  const kidsFields = {name:'kidName',gender:'kidGender',age:'kidAge',shirt:'kidShirt'};
  const form = new URLSearchParams();
  for (const field of fields) form.set(field,values[field]??'');
  for (let i=0;i<Number(values.children);i++) {
    for (const [property,prefix] of Object.entries(kidsFields)) {
      const field = prefix+i;
      fields.push(field);
      form.set(field,values.kids?.[i]?.[property]??'');
    }
  }
  if (!fields.includes(key)) return null;
  form.set(key,value);
  return reunionDetails(form);
}

export function partySummary(spouse, children) {
  const count = children==='' || children==null ? null : Number(children);
  if (String(spouse)==='0' && count===0) return 'Coming solo';
  const guests = [];
  if (String(spouse)==='1') guests.push('your spouse or partner');
  if (count>0) guests.push(count===1?'1 child':count+' children');
  return guests.length ? 'Coming with '+guests.join(' and ') : '';
}

export const agenda = [
  ['Saturday, 26 December','Arrive · Reconnect · Set the tone','2026-12-26',[
    ['12 noon onwards','Welcome to the Taj Amer','Find the IIMA desk at reception'],
    ['1:00–2:30 pm','Lunch','Jaigarh Lawns'],
    ['2:00–5:00 pm','Check-in and settle in','Class of 2006 check-in desk · Kit collection'],
    ['4:00–5:30 pm','High tea','Jaigarh Lawns'],
    ['5:30–6:30 pm','Get ready for the big night','Dress up for cocktails'],
    ['6:30–8:00 pm','Icebreakers with Tikli and Mansur','Jaigarh Banquet'],
    ['8:00–10:00 pm','Dinner and Oorja, the music band','Jaigarh Banquet'],
    ['10:00 pm onwards','DJ','Jaigarh Banquet']
  ],[
    ['4:00–5:30 pm','Parallel activities','Alumni T-Nite section prep, spouses’ bazaar, supervised art and craft for younger kids, and games for older kids']
  ]],
  ['Sunday, 27 December','Play · Explore · Create together','2026-12-27',[
    ['7:00–9:00 am','Women’s breakfast and batch run',''],
    ['8:00–10:00 am','Breakfast','Shamiana'],
    ['9:30–11:00 am','Family photos followed by batch photo','Jaigarh Lawns'],
    ['11:15–11:30 am','In memoriam','Jaigarh Banquet'],
    ['11:30 am–12:30 pm','Spotlight Us','Alumni-led session · Jaigarh Banquet'],
    ['12:45–1:30 pm','Group Wars','Jaigarh Lawns'],
    ['1:30–2:30 pm','Lunch','Jaigarh Banquet'],
    ['4:00–5:00 pm','High tea','Jaigarh Lawns'],
    ['5:00–6:00 pm','Break before the evening programme',''],
    ['6:00–7:00 pm','POTY Awards (20 years later)','Jaigarh Banquet'],
    ['7:00–8:00 pm','T-Nite Section Wars','Jaigarh Banquet'],
    ['8:00–9:30 pm','Dinner','Jaigarh Banquet'],
    ['9:30 pm onwards','DJ','Jaigarh Banquet']
  ],[
    ['10:30 am–1:30 pm','Parallel activities','Optional Jaipur sightseeing or hotel bazaar workshops for spouses. Activity bazaar, kite flying and LEGO for younger kids. Sports, kite flying, frisbee and chess for older kids.'],
    ['2:30–5:00 pm','Parallel activities continue','Sightseeing or bazaar workshops continue. Movie and quiet time for younger kids. Movie or PS5 for older kids.']
  ]],
  ['Monday, 28 December','Reflect · Recharge · Carry it forward','2026-12-28',[
    ['8:00–9:00 am','Yoga','Jaigarh Lawns'],
    ['8:00–10:00 am','Breakfast and catch-up','Shamiana'],
    ['10:00–11:30 am','Goodbyes and T-shirt signing','Jaigarh Lawns'],
    ['12 noon','Check-out','']
  ],[]]
];
