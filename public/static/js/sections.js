import { el, esc, q } from './core.js';
import { chips, fmtDate, fmtDuration, fmtTime, fmtVal, iconList, label, list, PATH_LABELS, readable, rows, section, sentence } from './format.js';
import { when } from './views/drawer.js';

/* ======================= per-product readable sections ======================= */
/* Total duration comes in two shapes: a fixed durationInMinutes, or a flexible
   {from,to,unit} range ("2 - 4 hours"). Reading only the first showed no duration at all
   on flexible products, which is what the portal displays as "Total Duration". */
export function totalDuration(it){
  const fd = it.flexibleDuration;
  if (fd && fd.from != null && fd.to != null){
    const u = String(fd.unit||'').toLowerCase() || 'hours';
    return fd.from === fd.to ? `${fd.from} ${u}` : `${fd.from} – ${fd.to} ${u}`;
  }
  return fmtDuration(it.durationInMinutes);
}
export function secOverview(p){
  const f = document.createDocumentFragment();
  const it = p.itinerary||{}, tx = p.taxonomy||{};
  const tItems = (tx.taxonomyItems||{}).taxonomyItemsMap||{};
  const names = g => ((tItems[g]||[]).map(x=>x.name).filter(Boolean));
  const langs = ((p.languageGuidesDetails||{}).languageGuides||[])
    .map(x=>{ const l = x.language||{};
      return l.name ? `${l.name}${l.isoCode?` (${l.isoCode})`:''}` : null; })
    .filter(Boolean);
  const lga = (p.languageGuidesDetails||{}).languageGuidesAttributes||{};
  f.appendChild(rows([
    ['Description', p.description ? esc(p.description) : (p.briefDescription ? esc(p.briefDescription) : null), 'product.description'],
    ['Total duration', p.duration || totalDuration(it), 'product.itinerary.durationInMinutes'],
    ['Category', p.category, 'product.category'],
    ['Location', p.location || (p.primaryLocationDetails && p.primaryLocationDetails.name), 'product.location'],
    ['Product type', p.productClassification ? sentence(p.productClassification) : null, 'product.productClassification'],
    ['Itinerary type', it.productItineraryType ? sentence(it.productItineraryType) : null, 'product.itinerary.productItineraryType'],
    ['Group type', it.privateTour===undefined?null:(it.privateTour?'Private':'Shared'), 'product.itinerary.privateTour'],
    ['Customizable', it.isCustomizable, 'product.itinerary.isCustomizable'],
    ['Customizable parts', (p.enabledCustomizationType||[]).length
        ? chips((p.enabledCustomizationType||[]).map(sentence)) : null],
    ['Skip the line', it.skipTheLine, 'product.itinerary.skipTheLine'],
    ['Product types', (tx.productTypes||[]).length?chips((tx.productTypes||[]).map(sentence)):null],
    ['Tour modes', names('TOUR_MODE').length?chips(names('TOUR_MODE')):null],
    ['Themes', p.themes ? chips(Array.isArray(p.themes)?p.themes:String(p.themes).split(',').map(s=>s.trim())) : (names('THEME').length?chips(names('THEME')):null)],
    ['Guide languages', langs.length?chips(langs):null],
    ['Guide certified', lga.isHumanGuideCertified, 'product.languageGuidesDetails.languageGuidesAttributes.isHumanGuideCertified'],
    ['Guide is the driver', lga.isHumanGuideDriver, 'product.languageGuidesDetails.languageGuidesAttributes.isHumanGuideDriver'],
    ['Guide status', lga.guideStatus ? sentence(lga.guideStatus) : null, 'product.languageGuidesDetails.languageGuidesAttributes.guideStatus'],
    ['Languages offered together', lga.isLanguagesOfferedTogether, 'product.languageGuidesDetails.languageGuidesAttributes.isLanguagesOfferedTogether'],
    ['Content language', p.locale, 'product.locale'],
    ['Reseller status', p.resellerInfo ? (
      p.resellerInfo==='NOT_RESELLER' ? 'Not acting as a reseller'
      : p.resellerInfo==='OFFICIAL' ? 'Official reseller'
      : sentence(p.resellerInfo)) : null, 'product.resellerInfo'],
    ['Traveller helpline', (p.contactDetail||{}).phoneNumber, 'product.contactDetail.phoneNumber'],
    ['Public page', p.localizedViatorUrl, 'product.localizedViatorUrl'],
  ]) || el('div','hint','No content recorded.'));
  /* keep the category and any longer description the portal shows alongside each item */
  const itemLine = x => {
    const ec = x.extraCharge||{};
    const charge = ec.amount!=null || ec.unit
      ? ` [extra charge${ec.amount!=null?` ${ec.amount}`:''}`+
        `${ec.currency?` ${ec.currency}`:''}${ec.unit?` ${sentence(ec.unit)}`:''}]` : '';
    return [x.displayText, x.description && x.description !== x.displayText
      ? `— ${x.description}` : '', x.category ? `(${sentence(x.category)})` : '', charge]
      .filter(Boolean).join(' ');
  };
  const inc = (p.inclusions||[]).map(itemLine).filter(Boolean);
  const exc = (p.exclusions||[]).map(itemLine).filter(Boolean);
  // ringed tick / ringed cross, the marks the portal itself uses for these two lists
  if (inc.length) f.appendChild(section("What's included", iconList(inc, 'inc')));
  if (exc.length) f.appendChild(section("What's excluded", iconList(exc, 'exc')));
  /* Every traveller note, with its Yes/No answer. Previously only the "true" ones were
     listed, so facts like "Wheelchair accessible: No" disappeared entirely. */
  const ais = (p.additionalInfo||[]).slice().sort((a,b)=>
    (a.additionalInfoOrder??0)-(b.additionalInfoOrder??0));
  if (ais.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>#</th><th>Detail</th><th>Applies</th></tr></thead>
      <tbody>${ais.map(x=>`<tr>
        <td class="mono">${x.additionalInfoOrder!=null?x.additionalInfoOrder:''}</td>
        <td>${esc(sentence(x.additionalInfoType||''))}
          ${x.freeText?`<div class="hint">${esc(x.freeText)}</div>`:''}</td>
        <td>${x.additionalInfoValue?'<span class="yes">Yes</span>'
                                   :'<span class="no">No</span>'}</td></tr>`).join('')}
      </tbody></table>`;
    f.appendChild(section(`Traveller notes (${ais.length})`, t));
  }
  /* Every safety measure with its Yes/No — listing only the applicable ones meant the
     measures themselves never appeared when none were applied. */
  const safety = ((p.enhancedSafetyMeasureDetails||{}).enhancedSafetyMeasures||[]).slice()
    .sort((a,b)=>(a.order??0)-(b.order??0));
  if (safety.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Measure</th><th>Applies</th></tr></thead><tbody>${
      safety.map(s=>`<tr><td>${esc(sentence(s.type||''))}</td>
        <td>${s.isApplicable?'<span class="yes">Yes</span>'
                            :'<span class="no">No</span>'}</td></tr>`).join('')}
      </tbody></table>`;
    const on = safety.filter(s=>s.isApplicable).length;
    f.appendChild(section(`Safety measures (${on} of ${safety.length} applied)`, t));
  }
  const pl = p.primaryLocationDetails||{};
  if (pl.name){
    f.appendChild(section('Primary location', rows([
      ['Place', pl.name, 'product.primaryLocationDetails.name'],
      ['Full name', pl.searchString || pl.description, 'product.primaryLocationDetails.searchString'],
      // placeExtras() folds several fields (locationAddress.*, tripAdvisorLocationId,
      // providerReference — the real identity anchor for this place) into one line of
      // text, so they need to be reachable from here too, not just their own row.
      ['Details', placeExtras(pl) || null, pl.name ? ['product.primaryLocationDetails.providerReference',
        'product.primaryLocationDetails.tripAdvisorLocationId',
        'product.primaryLocationDetails.locationAddress.city'] : null],
    ])));
  }
  const ta = p.tripAdvisorListing||{};
  if (ta.name || ta.readableAddress){
    f.appendChild(section('Tripadvisor listing', rows([
      ['Listing name', ta.name, 'product.tripAdvisorListing.name'],
      ['Listing location', ta.readableAddress, 'product.tripAdvisorListing.readableAddress'],
      ['Country matches', ta.isCountryMatched, 'product.tripAdvisorListing.isCountryMatched'],
      ['Other listings available', (p.availableTaListings||[]).length || null],
    ])));
  }
  /* Viator's OWN copy for this product — the short description and title it publishes,
     which can differ from the supplier's. Captured on 32 products but shown nowhere, so
     you could not compare what you wrote against what Viator actually displays. */
  const uc = p.uniqueContent||{};
  const vHigh = (uc.viatorHighlightItems||[]).map(x=>x.text||x).filter(Boolean);
  const taHigh = (uc.tripadvisorHighlightItems||[]).map(x=>x.text||x).filter(Boolean);
  if (uc.viatorShortDescription || uc.viatorMetaTitle || vHigh.length || taHigh.length){
    f.appendChild(section('Viator’s own listing copy', rows([
      ['Title Viator uses', uc.viatorMetaTitle, 'product.uniqueContent.viatorMetaTitle'],
      ['Short description', uc.viatorShortDescription
        ? esc(uc.viatorShortDescription) : null,
       'product.uniqueContent.viatorShortDescription'],
    ])));
    if (vHigh.length)
      f.appendChild(section(`Viator highlights (${vHigh.length})`,
        el('div','',list(vHigh))));
    if (taHigh.length)
      f.appendChild(section(`Tripadvisor highlights (${taHigh.length})`,
        el('div','',list(taHigh))));
  }
  const seo = p.productSeo||{};
  if (seo.productNameForUrlOverride || seo.forceNoIndex !== undefined){
    f.appendChild(section('Search listing', rows([
      ['Name used in the URL', seo.productNameForUrlOverride, 'product.productSeo.productNameForUrlOverride'],
      ['Hidden from search engines', seo.forceNoIndex, 'product.productSeo.forceNoIndex'],
    ])));
  }
  return f;
}

/* The portal's "Tour details": total duration + the ordered list of stops. This was
   missing entirely — itinerary.itineraryValues carry the description, dwell time and
   address of every stop. */
export function secTourDetails(p){
  const it = p.itinerary||{};
  const stops = (it.itineraryItems||[]).slice()
    .sort((a,b)=>(a.order??0)-(b.order??0));
  // activityItinerary flags an itinerary Viator considers non-conforming — a quality
  // signal worth surfacing, not hiding, even though only a couple of products carry it
  const ai = p.activityItinerary||{};
  if (!stops.length && !totalDuration(it)
      && ai.isNonConformingItinerary === undefined) return null;
  const f = document.createDocumentFragment();
  f.appendChild(rows([
    ['Total duration', totalDuration(it), 'product.itinerary.durationInMinutes'],
    ['Stops', stops.length || null],
    ['Time at stops', stops.length
      ? fmtDuration(stops.reduce((a,s)=>a+(s.durationInMinutes||0),0)) : null],
    ['Days', (it.days||[]).length || null],
    ['Meets Viator’s itinerary rules', ai.isNonConformingItinerary === undefined
      ? null : !ai.isNonConformingItinerary,
     'product.activityItinerary.isNonConformingItinerary'],
  ]));
  if (!stops.length) return f;
  const t = el('div','tblwrap');
  t.innerHTML = `<table><thead><tr><th>#</th><th>Place</th><th>Time there</th>
    <th>Admission</th><th>What happens</th></tr></thead><tbody>${
    stops.map((s,i)=>{
      const loc = s.poiLocation||{};
      const adm = s.admissionInclusionType;
      const admTxt = adm==='FREE' ? 'Free' : adm==='YES' ? 'Included'
        : adm==='NO' ? 'Not included' : (adm?sentence(adm):'—');
      const extras = placeExtras(loc);
      // Lets Edit history jump straight to THIS stop, not just the Stops table in
      // general — itineraryItemReference is the same id flatten() already keys this
      // stop's own change rows by, so the two can never point at different things.
      const jp = s.itineraryItemReference
        ? `product.itinerary.itineraryItems[${s.itineraryItemReference}]` : null;
      if (jp) PATH_LABELS.set(jp, `Stop ${i+1} — ${loc.name||loc.searchString||'itinerary'}`);
      return `<tr${jp ? ` data-jump-path="${esc(jp)}"` : ''}>
        <td class="mono">${i+1}</td>
        <td><div style="font-weight:600">${esc(loc.name||loc.searchString||'—')}</div>
            ${loc.searchString&&loc.name?`<div class="hint">${esc(loc.searchString)}</div>`:''}
            ${extras?`<div class="hint" style="margin-top:4px">${extras}</div>`:''}</td>
        <td style="white-space:nowrap">${esc(fmtDuration(s.durationInMinutes)||'—')}</td>
        <td>${esc(admTxt)}</td>
        <td>${esc(s.description||'')}</td></tr>`;
    }).join('')}</tbody></table>`;
  f.appendChild(section(`Stops (${stops.length})`, t));
  return f;
}

/* The portal's "Meeting & pickup". */
export function secMeeting(p){
  const dr = p.departureAndReturn||{}, po = p.pickupOption||{};
  // start points AND end points — end points were being dropped entirely
  const startArr = (p.startEndPoints||[]).length ? p.startEndPoints : (dr.startPoints||[]);
  // Which container each point actually came from — needed below to jump to the SAME
  // path flatten() keys its change rows by, which differs by container even for an
  // otherwise-identical point. Computed from the untagged objects, before tagging, so
  // the existing de-dup (a point appearing in both raw lists) still matches as before.
  const startContainer = (p.startEndPoints||[]).length
    ? 'product.startEndPoints' : 'product.departureAndReturn.startPoints';
  const endArr = dr.endPoints||[];
  const seen = new Set(startArr.map(s=>JSON.stringify(s)));
  const starts = startArr.map(s=>({...s, _container: startContainer}));
  const ends = endArr.filter(e=>!seen.has(JSON.stringify(e)))
    .map(s=>({...s, _container: 'product.departureAndReturn.endPoints'}));
  const pts = starts.concat(ends);
  if (!pts.length && !po.pickupOptionType && !dr.type) return null;
  const f = document.createDocumentFragment();
  f.appendChild(rows([
    // Viator's own flag that it dropped the location off a start/end point. It is the
    // one field in this capture that is BOTH invisible on the dashboard and actually
    // varying — true on 29 of 743 products — so it was real signal going unread. Shown
    // only when set, since "No" on 714 products is noise.
    ...(p.hasStartEndPointLocationDropped
        ? [['Start/end point location dropped by Viator', 'Yes — re-check the meeting point',
            'product.hasStartEndPointLocationDropped']] : []),
    ['Meeting arrangement', (po.pickupOptionType||dr.type)
      ? sentence(po.pickupOptionType||dr.type) : null, 'product.pickupOption.pickupOptionType'],
    ['Ends where it starts', po.endsAtStartPoint!==undefined?po.endsAtStartPoint
      : dr.endsAtStartPoint, 'product.pickupOption.endsAtStartPoint'],
    ['Pickup optional', po.isPickupOfferedAndOptional, 'product.pickupOption.isPickupOfferedAndOptional'],
    ['Travellers can enter their own pickup point', dr.allowCustomerPickupLocation, 'product.departureAndReturn.allowCustomerPickupLocation'],
  ]));
  if (pts.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Point</th><th>Address</th>
      <th>Instructions</th></tr></thead><tbody>${
      pts.map(s=>{
        const loc = s.location||{};
        const extras = placeExtras(loc);
        const jp = s.startEndPointReference
          ? `${s._container}[${s.startEndPointReference}]` : null;
        if (jp) PATH_LABELS.set(jp, loc.name || sentence(s.type||'Start point'));
        return `<tr${jp ? ` data-jump-path="${esc(jp)}"` : ''}>
          <td>${esc(sentence(s.type||'Start'))}</td>
          <td><div style="font-weight:600">${esc(loc.name||'—')}</div>
              <div class="hint">${esc(loc.searchString||loc.description||'')}</div>
              ${extras?`<div class="hint" style="margin-top:4px">${extras}</div>`:''}</td>
          <td>${esc(s.locationInstructions||'—')}</td></tr>`;
      }).join('')}</tbody></table>`;
    f.appendChild(section('Start & end points', t));
  }
  /* Traveller pickup: the list of hotels/points travellers can be collected from. This is
     the single biggest block of captured-but-unshown data — 45 locations on one product. */
  const tp = dr.travelerPickup||{};
  const areas = tp.locationAreas||[];
  if (areas.length || tp.additionalInfo){
    const r2 = rows([
      ['Pickup offered', tp.pickupOptionType ? sentence(tp.pickupOptionType) : (areas.length?true:null), 'product.departureAndReturn.travelerPickup.pickupOptionType'],
      ['Pickup areas', areas.length || null],
      ['Pickup points', areas.reduce((a,x)=>a+((x.locationsInArea||[]).length),0) || null],
      ['Extra pickup notes', tp.additionalInfo, 'product.departureAndReturn.travelerPickup.additionalInfo'],
    ]);
    if (r2) f.appendChild(section('Traveller pickup', r2));
    areas.forEach(a=>{
      const locs = a.locationsInArea||[];
      const cl = a.centreLocation||{};
      if (!locs.length){
        // an area can describe a catchment with no explicit points listed
        const only = rows([['Pickup area', (cl.location||{}).name || null],
          ['Centre coordinates', geo(cl.location||cl) || null],
          ['Radius', cl.areaRadiusInMeter!=null?`${cl.areaRadiusInMeter/1000} km`:null],
          ['Centre details', placeExtras(cl.location) || null]]);
        if (only) f.appendChild(section('Pickup area', only));
        return;
      }
      const centre = (cl.location||{}).name || (cl.location||{}).searchString || '';
      const radius = cl.areaRadiusInMeter ? ` · within ${(cl.areaRadiusInMeter/1000)} km` : '';
      const t2 = el('div','tblwrap');
      t2.innerHTML = `<table><thead><tr><th>#</th><th>Pickup point</th>
        <th>Coordinates</th></tr></thead><tbody>${
        locs.slice().sort((x,y)=>(x.order??0)-(y.order??0)).map((l,i)=>`<tr>
          <td class="mono">${l.order!=null?l.order:i+1}</td>
          <td><div style="font-weight:600">${esc(l.name||l.searchString||'—')}</div>
            ${l.description&&l.description!==l.name
              ? `<div class="hint">${esc(l.description)}</div>`:''}</td>
          <td>${geo(l)||'—'}</td></tr>`).join('')}
        </tbody></table>`;
      const cg = geo(cl.location||cl);
      f.appendChild(section(
        `Pickup points${centre?` near ${centre}`:''}${radius} (${locs.length})`, t2));
      const cr = rows([['Area centre', centre || null], ['Centre coordinates', cg || null],
        ['Radius', cl.areaRadiusInMeter!=null?`${cl.areaRadiusInMeter/1000} km`:null],
        ['Centre details', placeExtras(cl.location) || null]]);
      if (cr) f.appendChild(cr);
    });
  }
  return f;
}
/* Coordinates as a clickable map link, so the raw lat/long is still visible as text. */
export function geo(loc){
  const c = (loc||{}).centre||{};
  if (c.lat == null || c.long == null) return '';
  const t = `${c.lat}, ${c.long}`;
  return `<a href="https://www.google.com/maps?q=${c.lat},${c.long}" target="_blank"
    rel="noopener" class="mono">${esc(t)}</a>`;
}
/* Everything Viator knows about a place, beyond its name. */
export function placeExtras(loc){
  loc = loc || {};
  const bits = [];
  if (loc.rating != null) bits.push(`Rated ${loc.rating}`);
  if (loc.reviewCount != null) bits.push(`${Number(loc.reviewCount).toLocaleString()} reviews`);
  if (loc.ranking) bits.push(esc(loc.ranking));
  if (loc.matchedViatorLocation) bits.push(`Viator area: ${esc(loc.matchedViatorLocation)}`);
  const addr = loc.locationAddress||{};
  const place = [addr.line1, addr.line2, addr.city, addr.state, addr.postcode, addr.country]
    .filter(Boolean).join(', ');
  if (place) bits.push(esc(place));
  if ((loc.categories||[]).length) bits.push((loc.categories||[]).map(sentence).join(', '));
  const links = [];
  if (loc.website) links.push(`<a href="${esc(loc.website)}" target="_blank" rel="noopener">Website</a>`);
  if (loc.tripAdvisorUrl) links.push(
    `<a href="${esc(loc.tripAdvisorUrl)}" target="_blank" rel="noopener">Tripadvisor`+
    `${loc.tripAdvisorLocationId?` #${esc(loc.tripAdvisorLocationId)}`:''}</a>`);
  else if (loc.tripAdvisorLocationId)      // id without a link is still worth showing
    links.push(`<span class="mono">Tripadvisor #${esc(loc.tripAdvisorLocationId)}</span>`);
  const g = geo(loc);
  if (g) links.push(g);
  return [bits.join(' · '), links.join(' · ')].filter(Boolean).join('<br>');
}

/* The commission the portal shows is the EFFECTIVE rate: base + Accelerate boost when
   opted in. Recomputed here from pricing rather than reading the stored
   commission_percent, so snapshots captured before this was fixed also display the right
   number instead of the base rate. */
export function commissionOf(p){
  const pr = p.pricing||{}, ppm = pr.productProgramMargin||{};
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  let v = num(ppm.averageActualMargin); if (v !== null) return v;
  v = num(ppm.minimumActualMargin); if (v !== null) return v;
  for (const b of Object.values(pr.minimalMarginDetails||{})){
    const a = num((b||{}).actualMargin); if (a !== null) return a;
  }
  for (const m of Object.values(pr.minimalMargins||{})){
    const f = num(m); if (f !== null) return f <= 1 ? Math.round(f*10000)/100 : f;
  }
  const base = num(ppm.baseMargin), boost = num(ppm.boostMargin);
  if (base !== null) return ppm.isOptedIn ? base + (boost||0) : base;
  return null;
}

/* Money in the product's own currency: 1245 -> €1,245.00 */
export function money(v, ccy){
  if (v === null || v === undefined || v === '') return null;
  try { return new Intl.NumberFormat('en-US',
    {style:'currency', currency: ccy||'EUR'}).format(v); }
  catch(e){ return `${v} ${ccy||''}`.trim(); }
}
/* "0-1", "5-15", "5+" from the traveller range on a price tier */
export function travellerRange(mm){
  if (!mm) return '—';
  const lo = mm.lowerEndpoint, hi = mm.upperEndpoint;
  if (lo == null && hi == null) return 'Any';
  if (hi == null) return `${lo}+`;
  // Always "lo-hi", even when equal: the portal writes "2-2", not "2", and matching its
  // notation keeps the dashboard directly comparable to the page it came from.
  return `${lo}-${hi}`;
}
/* The portal's "SUGGESTED RETAIL PRICE" line:
   Adult: 0-1, €1,245.00 | 2-2, €623.00 | 3-3, €415.00 ...
   Lives in pricing.pricingPackages[ref].priceTiersForAgeBands[BAND][]. */
export function priceTierTable(pkg, ccy){
  const tiers = pkg.priceTiersForAgeBands||{};
  const bands = Object.keys(tiers).filter(b=>(tiers[b]||[]).length);
  /* A package priced per UNIT (a whole group/vehicle) carries a single flat price instead
     of per-age-band tiers. Handling only the tiered shape meant these products showed no
     price at all. */
  if (!bands.length && pkg.price){
    const pri = pkg.price;
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Priced as</th><th>Suggested retail</th>
      <th>You receive</th><th>Commission</th></tr></thead><tbody><tr>
      <td>${esc(sentence(pkg.type||'Unit'))}</td>
      <td class="v num"><b>${esc(money(pri.retailPrice,ccy)||'—')}</b></td>
      <td class="v num">${esc(money(pri.netPrice,ccy)||'—')}</td>
      <td class="v num">${pri.marginPercent!=null?esc(pri.marginPercent)+'%':'—'}</td>
      </tr></tbody></table>`;
    return t;
  }
  if (!bands.length) return null;
  const t = el('div','tblwrap');
  let body = '';
  bands.forEach(band=>{
    (tiers[band]||[]).forEach((tier,i)=>{
      const pri = tier.price||{};
      body += `<tr>
        <td>${i===0?`<b>${esc(sentence(band))}</b>`:''}</td>
        <td class="mono">${esc(travellerRange(tier.minMaxTravellers))}</td>
        <td class="v num"><b>${esc(money(pri.retailPrice,ccy)||'—')}</b></td>
        <td class="v num">${esc(money(pri.netPrice,ccy)||'—')}</td>
        <td class="v num">${pri.marginPercent!=null?esc(pri.marginPercent)+'%':'—'}</td></tr>`;
    });
  });
  t.innerHTML = `<table><thead><tr><th>Age band</th><th>Travellers</th>
    <th>Suggested retail</th><th>You receive</th><th>Commission</th></tr></thead>
    <tbody>${body}</tbody></table>`;
  return t;
}
export function secPricing(p, cur){
  const f = document.createDocumentFragment();
  const pr = p.pricing||{};
  const times = (pr.allStartTimes||[]).map(t=>fmtTime(t.startTime)).filter(Boolean);
  const ppm = pr.productProgramMargin||{};
  f.appendChild(rows([
    ['Currency', p.currency, 'product.currency'],
    // effective rate first — this is the figure the portal prints as "Commission Rate"
    ['Commission rate', (()=>{ const c = commissionOf(p);
        if (c === null) return null;
        const b = ppm.baseMargin, bo = ppm.boostMargin;
        return (ppm.isOptedIn && bo)
          ? `<b>${c}%</b> <span class="hint">(base ${b}% + ${bo}% boost)</span>`
          : `<b>${c}%</b>`; })()],
    ['Base commission', ppm.baseMargin!=null?ppm.baseMargin+'%':null, 'product.pricing.productProgramMargin.baseMargin'],
    ['Accelerate boost', ppm.isOptedIn ? `${ppm.boostMargin||0}% (opted in)`
       : (ppm.boostMargin ? `${ppm.boostMargin}% (not opted in)` : 'Not opted in')],
    ['Commission range', ppm.baseMargin!=null&&ppm.maxMargin!=null
       ? `${ppm.baseMargin}% – ${ppm.maxMargin}% max` : null],
    ['Average actual margin', ppm.averageActualMargin!=null
       ? `${ppm.averageActualMargin}%` : null, 'product.pricing.productProgramMargin.averageActualMargin'],
    ['Minimum actual margin', ppm.minimumActualMargin!=null
       ? `${ppm.minimumActualMargin}%` : null, 'product.pricing.productProgramMargin.minimumActualMargin'],
    ['Target minimum margin', ppm.targetedMinimumMargin!=null
       ? `${ppm.targetedMinimumMargin}%` : null, 'product.pricing.productProgramMargin.targetedMinimumMargin'],
    ['Start times', times.length?chips(times):null],
    ['Week starts', pr.scheduleStartDay?sentence(pr.scheduleStartDay):null, 'product.pricing.scheduleStartDay'],
    ['Priced per', (p.bookingSettings||{}).priceUnitType
       ? sentence(p.bookingSettings.priceUnitType) : null, 'product.bookingSettings.priceUnitType'],
    ['Options', (p.productOptions||[]).length],
    ['Tiered pricing', pr.hasTieredPricingEnabled, 'product.pricing.hasTieredPricingEnabled'],
    ['Start time type', pr.startTimeType ? sentence(pr.startTimeType) : null, 'product.pricing.startTimeType'],
    ['Dynamic pricing', pr.dynamicPricingControl
       ? sentence(pr.dynamicPricingControl) : null, 'product.pricing.dynamicPricingControl'],
    ['Active start times', pr.hasActiveStartTimes, 'product.pricing.hasActiveStartTimes'],
    ['Price unit', (p.bookingSettings||{}).priceUnit
       ? sentence(p.bookingSettings.priceUnit) : null, 'product.bookingSettings.priceUnit'],
    ['Minimum margin', (()=>{ const mm = pr.minimalMargins||{};
       const v = mm.ADULT ?? Object.values(mm)[0];
       return v!=null ? (v<=1 ? (v*100).toFixed(0) : v)+'%' : null; })()],
  ]) || el('div','hint','No pricing recorded.'));

  /* Which days each schedule runs on — the portal's "Sun, Mon, Tue, Wed, Thu, Fri, Sat". */
  const DAY = {SUNDAY:'Sun',MONDAY:'Mon',TUESDAY:'Tue',WEDNESDAY:'Wed',THURSDAY:'Thu',
               FRIDAY:'Fri',SATURDAY:'Sat'};
  const ORDER = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const raws = Object.values(pr.rawPricingRecords||{});
  if (raws.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Schedule</th><th>Runs on</th>
      <th>Start times</th></tr></thead><tbody>${
      raws.map((rec,i)=>{
        const days = (rec.daysOfWeek||[]).slice()
          .sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b)).map(d=>DAY[d]||sentence(d));
        const times = (rec.startTimes||[]).map(t2=>fmtTime(t2.startTime))
          .filter(Boolean).sort();
        return `<tr><td class="mono">${i+1}</td>
          <td>${days.length===7?'Every day':esc(days.join(', '))||'—'}</td>
          <td>${esc(times.join(', '))||'—'}</td></tr>`;
      }).join('')}</tbody></table>`;
    f.appendChild(section(`Schedules (${raws.length})`, t));
  }

  /* Suggested retail price per age band and traveller count — the portal's headline
     pricing line. One table per option, labelled the way the portal labels it. */
  const pkgs = pr.pricingPackages||{};
  const opts = (cur && cur.product_options) || {};
  const optOfPkg = {};   // package ref -> option ref, via the raw pricing records
  Object.values(pr.rawPricingRecords||{}).forEach(rec=>{
    if (rec && rec.pricingPackageRef) optOfPkg[rec.pricingPackageRef] = rec.productOptionRef;
  });
  const pkgEntries = Object.entries(pkgs);
  pkgEntries.forEach(([ref,pkg])=>{
    const tbl = priceTierTable(pkg, p.currency);
    if (!tbl) return;
    const o = opts[optOfPkg[ref]] || {};
    const name = o.title
      ? `${o.title}${o.tourGradeCode?` (${o.tourGradeCode})`:''}`
      : 'Suggested retail price';
    // Extract season date span from package ref if present (e.g. PPP-AIS-2027-12-24_..._2027-11-20_...)
    const dateMatches = ref.match(/(\d{4}-\d{2}-\d{2})/g) || [];
    let seasonTag = '';
    if (dateMatches.length >= 2) {
      const endD = dateMatches[0], startD = dateMatches[1];
      if (endD === '2099-12-31') {
        if (pkgEntries.length > 1) seasonTag = 'Default season';
      } else {
        seasonTag = `${fmtDate(startD) || startD} – ${fmtDate(endD) || endD}`;
      }
    }
    const labelTitle = `Prices — ${name}${seasonTag ? ` (${seasonTag})` : ''}`;
    const headerTitle = `Prices — ${name}${seasonTag ? ` · ${seasonTag}` : ''}`;
    const jp = `product.pricing.pricingPackages.${ref}`;
    PATH_LABELS.set(jp, labelTitle);
    f.appendChild(section(headerTitle, tbl, jp));
  });
  const minSrp = pr.minimumSuggestedRetailPriceByAgeBands||{};
  const minRows = Object.entries(minSrp).filter(([,v])=>v!=null)
    .map(([b,v])=>[sentence(b), money(v,p.currency)]);
  if (minRows.length) f.appendChild(section('Lowest price Viator allows', rows(minRows)));
  const seasonEntries = Object.entries(pr.seasons||{});
  if (seasonEntries.length){
    // Map seasonRef -> Option Title (via pr.pricingRecords) if available
    const optBySeason = {};
    Object.entries(pr.pricingRecords || {}).forEach(([optRef, sMap]) => {
      const o = opts[optRef] || {};
      const optName = o.title ? `${o.title}${o.tourGradeCode ? ` (${o.tourGradeCode})` : ''}` : o.tourGradeCode;
      if (optName && typeof sMap === 'object') {
        Object.keys(sMap).forEach(sRef => { optBySeason[sRef] = optName; });
      }
    });

    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Season</th><th>From</th><th>To</th>
      <th>Time zone</th><th>Active</th></tr></thead><tbody>${
      seasonEntries.slice(0,40).map(([ref,s])=>{
        const jp = `product.pricing.seasons.${ref}`;
        const optName = optBySeason[ref] || '';
        const dateSpan = (s.startDate || s.endDate)
          ? `${fmtDate(s.startDate)||s.startDate||'?'} – ${fmtDate(s.endDate)||s.endDate||'?'}` : '';
        const seasonDesc = s.isDefaultSeason ? 'Default season'
          : `Season (${[dateSpan, optName].filter(Boolean).join(' · ') || 'Seasonal availability'})`;
        PATH_LABELS.set(jp, seasonDesc);
        return `<tr data-jump-path="${esc(jp)}">
        <td>${s.isDefaultSeason?'Default':(optName ? `Seasonal (${esc(optName)})` : 'Seasonal')}</td>
        <td>${esc(fmtDate(s.startDate)||s.startDate||'—')}</td>
        <td>${esc(fmtDate(s.endDate)||s.endDate||'no end date')}</td>
        <td>${esc(s.timeZone||'—')}</td>
        <td>${s.isActive?'<span class="yes">Yes</span>':'<span class="no">No</span>'}</td>
      </tr>`;}).join('')}</tbody></table>`;
    f.appendChild(section(`Seasons (${seasonEntries.length})`, t));
  }
  const noPrice = (p.ageBandsWithNoPricing||[]).map(x=>x.name||x).filter(Boolean);
  if (noPrice.length) f.appendChild(section('Age bands with NO pricing set',
    el('div','', chips(noPrice.map(sentence)))));
  /* "Entrance fee Mozart's Birthplace — Morning tour". The option titles are only worth
     printing when the product actually has named options: DEFAULT is the portal's word
     for the single unnamed one, so saying it would add noise, not information. */
  const extras = p.extraChargesWithOptions||[];
  if (extras.length) f.appendChild(section(`Extra charges (${extras.length})`,
    el('div','', list(extras.map(x=>{
      const opts = (x.productOptions||[]).map(o=>o.productOptionTitle)
        .filter(t=>t && t !== 'DEFAULT');
      const name = readable(x);
      return opts.length ? `${name} — ${opts.join(', ')}` : name;
    }).filter(Boolean)))));
  const bands = (p.ageBands||[]).filter(b=>b.name);
  if (bands.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Age band</th><th>Ages</th><th>In use</th></tr></thead>
      <tbody>${bands.map(b=>`<tr><td>${esc(sentence(b.name))}</td>
        <td class="mono">${b.minimumAge??'?'}–${b.maximumAge??'?'}</td>
        <td>${b.isUsed?'<span class="yes">Yes</span>':'<span class="no">No</span>'}</td>
        </tr>`).join('')}</tbody></table>`;
    f.appendChild(section('Age bands', t));
  }
  return f;
}
export function secBooking(p){
  const f = document.createDocumentFragment();
  const bc = p.bookingConfirmationSettings||{}, cp = p.cancellationPolicy||{};
  const t = (cp.cancellationPolicyType)||{};
  f.appendChild(rows([
    ['Confirmation', bc.confirmationType?sentence(bc.confirmationType):null, 'product.bookingConfirmationSettings.confirmationType'],
    ['Cut-off', bc.bookingCutoffInHours!=null
       ? `${bc.bookingCutoffInHours} hour${bc.bookingCutoffInHours===1?'':'s'} before `+
         `${(bc.bookingCutoffType||'').toLowerCase().replace(/_/g,' ')||'start'}` : null, 'product.bookingConfirmationSettings.bookingCutoffInHours'],
    ['Cut-off measured from', bc.bookingCutoffType ? sentence(bc.bookingCutoffType) : null, 'product.bookingConfirmationSettings.bookingCutoffType'],
    ['Email me every booking', bc.isSendNotificationForEachBooking, 'product.bookingConfirmationSettings.isSendNotificationForEachBooking'],
    ['Cancellation policy', t.displayText||null, 'product.cancellationPolicy.cancellationPolicyType.displayText'],
    ['Bad-weather cancellation', cp.supplierCanCancelOnBadWeather, 'product.cancellationPolicy.supplierCanCancelOnBadWeather'],
    ['Priced per', (p.bookingSettings||{}).priceUnitType
       ? sentence(p.bookingSettings.priceUnitType) : null, 'product.bookingSettings.priceUnitType'],
  ]) || el('div','hint','No booking settings recorded.'));
  const conds = t.conditions||[];
  if (conds.length){
    const t2 = el('div','tblwrap');
    t2.innerHTML = `<table><thead><tr><th>Cancelled this far ahead</th><th>Refund</th></tr></thead>
      <tbody>${conds.map(c=>`<tr>
        <td>${c.toDays>0?`${c.toDays}+ day${c.toDays===1?'':'s'} before`:'Less than 1 day before'}</td>
        <td><b>${esc(c.refundPercentage)}%</b></td></tr>`).join('')}</tbody></table>`;
    f.appendChild(section('Refund terms', t2));
  }
  const tri = p.travellerRequiredInfo||{};
  // passportType is a STRING ("REQUIRED_BEFORE_AND_ON_DAY_OF_TRAVEL"), not a boolean, so
  // the chip list below — which only shows fields that are true — silently never included
  // it even though it is real, human-set booking config, same as the rest of this object.
  const askedKeys = Object.keys(tri).filter(k=>k!=='alsoRequiredFields' && k!=='passportType' && tri[k]===true);
  const asked = askedKeys.map(label);
  const passportLine = tri.passportType
    ? `<div class="hint" style="margin-bottom:8px">Passport: ${esc(sentence(tri.passportType))}</div>` : '';
  const body = el('div','', passportLine + (asked.length?chips(asked)
    : (tri.passportType ? '' : '<span class="hint">Nothing beyond the standard details.</span>')));
  f.appendChild(section('Information collected from travellers', body,
    [...askedKeys, ...(tri.passportType?['passportType']:[])]
      .map(k=>`product.travellerRequiredInfo.${k}`)));
  const perm = (p.permittedCancellationPolicyTypes||[]).map(x=>x.displayText).filter(Boolean);
  if (perm.length) f.appendChild(section('Policies you could switch to',
    el('div','', chips(perm))));
  const faqs = p.productFaqs||[];
  if (faqs.length) f.appendChild(section(`FAQs (${faqs.length})`,
    el('div','', list(faqs.map(x=>x.question||x.title||readable(x)).filter(Boolean)))));
  return f;
}
export function secTickets(p){
  const v = p.voucher||{};
  return rows([
    ['Ticket format', v.ticketType?sentence(v.ticketType):null, 'product.voucher.ticketType'],
    ['Tickets per booking', v.ticketsPerBooking?sentence(v.ticketsPerBooking):null, 'product.voucher.ticketsPerBooking'],
    ['Exchange point', v.exchangePoint?sentence(v.exchangePoint):null, 'product.voucher.exchangePoint'],
    ['Barcode format', v.barcodeType, 'product.voucher.barcodeType'],
    ['Show barcode on ticket', v.showBarcodeOnTicket, 'product.voucher.showBarcodeOnTicket'],
    ['Special instructions', v.specialInstructions||null, 'product.voucher.specialInstructions'],
    ['Own logo on ticket', v.productLogoImageRef ? 'Yes' : 'No'],
  ]) || el('div','hint','No ticket settings recorded.');
}
export function secConnection(p, cur){
  const f = document.createDocumentFragment();
  const cd = p.connectionDetails||{}, rs = (cur&&cur.connectivity)||{};
  const sync = cd.syncDetails||{};
  f.appendChild(rows([
    ['Connected', cd.supplierProductCode?'Yes':'No'],
    ['Your system’s product code', cd.supplierProductCode||null, 'product.connectionDetails.supplierProductCode'],
    ['Reservation system', rs.reservationSystemName||null],
    ['Managed by external system',
      (p.externalReference||{}).isManagedByExternalReservationSystem, 'product.externalReference.isManagedByExternalReservationSystem'],
    ...Object.keys(sync).map(k=>[`${sentence(k)} sync`, !!(sync[k]||{}).isEnabled]),
  ]) || el('div','hint','Not connected to a reservation system.'));
  /* Per-option mapping into the supplier's own system. The portal lists these under
     Product connection as "Product code / Option / Product option ID" — the labels come
     straight from the portal's own thirdPartyMappings, so they always match. */
  const opts = (cur && cur.product_options) || {};
  Object.entries(opts).forEach(([ref,o])=>{
    const ocd = o.connectionDetails||{};
    const maps = ocd.thirdPartyMappings||[];
    const name = `${o.title||'Option'}${o.tourGradeCode?` (${o.tourGradeCode})`:''}`;
    const pairs = [
      ['Status', ocd.isProductOptionConnectionMappingSpecified===undefined ? null
        : (ocd.isProductOptionConnectionMappingSpecified ? 'Connected' : 'Not connected')],
      ...maps.map(m=>[m.label||m.name, m.value]),
      ['Option sync', ocd.isOptionSyncEnabled],
      ['Price sync', ocd.isProductOptionPriceSyncEnabled],
      ['Auto-sync start times', ocd.isAutoSyncStartTime],
      ['Timed entry', ocd.isProductConnectionTimedEntry],
      // These three (unlike everything above) are real, employee-driven option state —
      // the only ones a change actually gets recorded for — so they carry a path.
      ['Option status', o.status ? sentence(o.status) : null, `product_options.${ref}.status`],
      ['Default option', o.isDefaultOption, `product_options.${ref}.isDefaultOption`],
      ['Pickup included', o.isPickupIncluded, `product_options.${ref}.isPickupIncluded`],
    ];
    const r = rows(pairs);
    // title/tourGradeCode have no row of their own — they ARE this section's own heading
    // — so the section itself is the jump target for a change to either of them.
    if (r) f.appendChild(section(`Option — ${name}`, r, `product_options.${ref}`));
  });
  const ps = p.productPricingSyncToggleSapiV2||{};
  if (Object.keys(ps).length) f.appendChild(section('Automatic pricing sync', rows([
    ['Turned on', ps.isPricingSyncToggleEnabledSapiV2, 'product.productPricingSyncToggleSapiV2.isPricingSyncToggleEnabledSapiV2'],
    ['Was on previously', ps.wasPricingSyncTogglePreviouslyEnabledSapiV2],
    ['You can change it', ps.isPricingSyncToggleReadonlySapiV2===undefined?null
      : !ps.isPricingSyncToggleReadonlySapiV2],
    ['Why not', ps.pricingSyncToggleReadonlyReasonSapiV2
      ? sentence(ps.pricingSyncToggleReadonlyReasonSapiV2) : null],
  ])));
  return f;
}
export function secOffers(p){
  const f = document.createDocumentFragment();
  const so = p.specialOfferInfo||{};
  const dur = so.durationInformation||{}, elig = so.specialOfferEligibility||{};
  const active = Object.keys(so.specialOffers||{}).length;
  f.appendChild(rows([
    ['Active offers', active],
    ['Eligible for a special offer', elig.isEligibleToRunSpecialOffer, 'product.specialOfferInfo.specialOfferEligibility.isEligibleToRunSpecialOffer'],
    ['Eligible for an intro offer', elig.isEligibleToRunIntroOffer, 'product.specialOfferInfo.specialOfferEligibility.isEligibleToRunIntroOffer'],
    ['Special days used this year', dur.specialDaysThisYear, 'product.specialOfferInfo.durationInformation.specialDaysThisYear'],
    ['Allowed per year', dur.maxSpecialDaysThisYear, 'product.specialOfferInfo.durationInformation.maxSpecialDaysThisYear'],
    ['Max length of one offer', dur.maxDaysSpecialCanRun!=null
       ? `${dur.maxDaysSpecialCanRun} days` : null],
    ['Offers run previously', dur.previousSpecialDaysRun, 'product.specialOfferInfo.durationInformation.previousSpecialDaysRun'],
    ['Last offer ran', dur.lastSpecialStartDate
      ? `${fmtDate(dur.lastSpecialStartDate)||dur.lastSpecialStartDate} – `+
        `${fmtDate(dur.lastSpecialEndDate)||dur.lastSpecialEndDate||'?'}` : null],
    ['Comparison price', money(so.comparisonPriceForSpecial, p.currency), 'product.specialOfferInfo.comparisonPriceForSpecial'],
  ]) || el('div','hint','No special offer data.'));
  /* The offers themselves — previously only counted. Each has a name, an incentive and
     separate booking and travel windows. */
  const offers = Object.entries(so.specialOffers||{});
  if (offers.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Offer</th><th>Kind</th><th>Discount</th>
      <th>Bookable</th><th>Travel dates</th></tr></thead><tbody>${
      offers.map(([ref,o])=>{
        const span = (a,b) => a||b
          ? `${a?(fmtDate(a)||a):'?'} – ${b?(fmtDate(b)||b):'?'}` : '—';
        const amt = o.incentiveValue ?? o.discountPercent ?? o.value;
        return `<tr>
          <td><div style="font-weight:600">${esc(o.name||ref)}</div>
            ${o.specialType?`<div class="hint">${esc(sentence(o.specialType))}</div>`:''}</td>
          <td>${esc(o.type?sentence(o.type):'—')}</td>
          <td>${esc(o.incentiveType?sentence(o.incentiveType):'—')}${
            amt!=null?` · ${esc(amt)}${/PERCENT/i.test(o.incentiveType||'')?'%':''}`:''}</td>
          <td style="white-space:nowrap">${esc(span(o.bookingStartDate,o.bookingEndDate))}</td>
          <td style="white-space:nowrap">${esc(span(o.travelStartDate,o.travelEndDate))}</td>
          </tr>`;
      }).join('')}</tbody></table>`;
    f.appendChild(section(`Offers on record (${offers.length})`, t));
  }
  /* WHY an offer can't run — the portal only shows the outcome, not the reasons. */
  const viol = elig.eligibilityViolations||[];
  if (viol.length) f.appendChild(section('Why an offer cannot run now',
    el('div','', list(viol.map(v=>{
      const why = sentence(v.type||v.name||readable(v));
      const kind = v.value && v.value.offerType ? ` (${sentence(v.value.offerType)})` : '';
      return why + kind;
    })))));
  const cmp = so.calculatedComparisonPrices||{};
  const cmpRows = Object.values(cmp).map(c=>[
    c.expiresAt ? `Valid until ${fmtDate(c.expiresAt)||String(c.expiresAt).slice(0,10)}`
                : 'Comparison price',
    money(c.comparisonPrice, p.currency)]).filter(x=>x[1]);
  if (cmpRows.length) f.appendChild(section('Price an offer is compared against',
    rows(cmpRows)));
  return f;
}
export function secQuality(cur){
  const f = document.createDocumentFragment();
  const p = cur.product||{};
  const rr = cur.review_rating||{}, perf = cur.performance||{};
  const imp = (cur.improvements||{}).improvementItemList||[];
  const act = p.productActivationWebModel||{};
  f.appendChild(rows([
    ['Quality', cur.quality_level?(cur.quality_level==='GOOD'?'Good':'Needs work'):null, 'quality_level'],
    ['Rating', rr.totalReviewCount ? `${rr.rating} from ${rr.totalReviewCount} reviews`
       : 'No reviews yet', ['review_rating.rating', 'review_rating.totalReviewCount']],
    ['Performance', perf.performanceStatus?sentence(perf.performanceStatus):null, 'performance.performanceStatus'],
    ['Synced with your system', cur.roster_sync?cur.roster_sync.synced:null],
    ['Needs attention', cur.roster_sync?cur.roster_sync.needs_attention:null],
  ]) || el('div','hint','No quality data.'));
  if (imp.length) f.appendChild(section('Viator suggests improving',
    el('div','',list(imp.map(sentence))),
    // A REMOVED suggestion has nothing to jump to (it's gone from imp by definition —
    // the same "field no longer on the page" case as a deleted product_options entry),
    // but a still-current one can jump here: same identity flatten() keys it by.
    imp.map(v=>`improvements.improvementItemList[=${v}]`)));
  /* Viator's own quality checks, pass/fail per requirement, with the reasons it gives. */
  const traitCode = Object.keys(cur.product_traits||{})[0];
  const traits = (traitCode && cur.product_traits[traitCode]) || {};
  const tlist = Object.entries(traits).filter(([,t])=>t && t.name);
  if (tlist.length){
    const t = el('div','tblwrap');
    t.innerHTML = `<table><thead><tr><th>Requirement</th><th>Met</th>
      <th>Issues</th></tr></thead><tbody>${
      tlist.map(([key,x])=>{
        // No id-shaped segment sits in this path (a trait code like "PASSPORT_TYPE" and
        // a product code like "197063P32" are both plain words, not a generated id), so
        // entityKey() cannot collapse .isSatisfied/.violations to one shared entity key
        // the way it does for product_options — each keeps its own full path, and both
        // need to be listed here for either one to find this row.
        const base = `product_traits.${traitCode}.${key}`;
        const jps = [`${base}.isSatisfied`, `${base}.violations`];
        jps.forEach(jp => PATH_LABELS.set(jp, sentence(x.name)));
        return `<tr data-jump-path="${esc(jps.join(' '))}"><td>${esc(sentence(x.name))}</td>
        <td>${x.isSatisfied?'<span class="yes">Yes</span>':'<span class="no">No</span>'}</td>
        <td>${(x.violations||[]).length
          ? esc((x.violations||[]).map(v=>typeof v==='string'?sentence(v)
              :sentence(v.type||v.name||readable(v))).filter(Boolean).join(', '))
          : '<span class="hint">—</span>'}</td></tr>`;}).join('')}</tbody></table>`;
    const failed = tlist.filter(x=>!x.isSatisfied).length;
    f.appendChild(section(
      `Viator quality checks (${tlist.length - failed}/${tlist.length} met)`, t));
  }
  const asDate = ms => ms ? fmtDate(new Date(ms).toISOString().slice(0,10)) : null;
  if (Object.keys(act).length) f.appendChild(section('Activation history', rows([
    ['Can be activated', act.canActivate],
    ['Can be terminated', act.canTerminate],
    ['Activated by', act.activationOperatorFullName],
    ['Activated on', asDate(act.activationTime)],
    ['Deactivated by', act.deactivationOperatorFullName || act.terminationOperatorFullName],
    ['Deactivated on', asDate(act.deactivationTime || act.terminationTime)],
    ['Reason given', act.deactivationReasonText],
    ['Cannot be reactivated', act.showUnreactivatableText],
  ])));
  return f;
}
/* A tab's content as a FLAT stack of blocks, which is how the portal builds a page:
   Connectivity, then the option, then Product pricing attributes — never a card inside a
   card. A section builder emits its main field list loose and its extra parts already
   wrapped by section(); this makes the loose part the first block, named for the section,
   and lets the rest follow as its siblings. */
function stack(title, node){
  if (!node) return [];
  const out = [], loose = document.createDocumentFragment();
  [...node.childNodes].forEach(n => {
    if (n.nodeType === 1 && n.classList && n.classList.contains('vsec')) out.push(n);
    else loose.appendChild(n);
  });
  if (loose.childNodes.length){
    const holder = el('div');
    holder.appendChild(loose);
    out.unshift(section(title, holder));
  }
  return out;
}
function group(...parts){
  const wrap = el('div','vsecs');
  parts.forEach(([title, node]) =>
    stack(title, node).forEach(b => wrap.appendChild(b)));
  return wrap.children.length ? wrap : null;
}

/* The tabs, and their names, are the portal's own — so someone who works in Viator all
   day finds the same thing in the same place here. Translations is the one tab the portal
   has that this never will: the client's rule is that it is never opened, and capture
   satisfies that structurally (see strip_translations). */
export function buildSections(cur){
  const p = cur.product||{};
  const isSpreadsheet = cur.imported_from_spreadsheet || !!cur.raw_row_data;
  const out = [];
  const add = (n, node) => {
    if (node && node.children && node.children.length > 0) out.push([n,node]);
  };
  add('Product content', group(['Product setup', secOverview(p)],
                               ['Tour details', secTourDetails(p)],
                               ['Meeting & pickup', secMeeting(p)]));
  add('Schedules & prices', group(['Pricing', secPricing(p, cur)]));
  if (!isSpreadsheet) {
    add('Booking details', group(['Booking settings', secBooking(p)]));
    add('Tickets', group(['Ticket settings', secTickets(p)]));
    add('Product connection', group(['Connection', secConnection(p, cur)]));
    add('Special offers', group(['Special offers', secOffers(p)]));
    add('Quality', group(['Quality', secQuality(cur)]));
  } else {
    const bk = group(['Booking settings', secBooking(p)]);
    if (bk) add('Booking details', bk);
    const conn = group(['Connection', secConnection(p, cur)]);
    if (conn) add('Product connection', conn);
  }
  return out;
}

/* raw JSON tree — kept as an escape hatch, no longer the default view */
export function tree(obj, depth=0){
  const wrap = el('div');
  if (obj===null||obj===undefined) return el('div','hint','—');
  if (typeof obj!=='object'){ wrap.appendChild(el('div','v',esc(obj))); return wrap; }
  const entries = Array.isArray(obj)?obj.map((v,i)=>[i,v]):Object.entries(obj);
  const leaves = entries.filter(([,v])=>v===null||typeof v!=='object');
  const nodes = entries.filter(([,v])=>v!==null&&typeof v==='object');
  if (leaves.length){
    const r = el('div','rows');
    leaves.forEach(([k,v])=>{ r.appendChild(el('div','k',esc(k)));
      r.appendChild(el('div','v',fmtVal(v,String(k)))); });
    wrap.appendChild(r);
  }
  nodes.forEach(([k,v])=>{
    const d = el('details'); d.style.cssText='margin:6px 0 6px 4px;padding-left:11px;border-left:2px solid var(--line)';
    const n = Array.isArray(v)?`${v.length} item${v.length===1?'':'s'}`:`${Object.keys(v).length} fields`;
    const s = el('summary','',`<b>${esc(label(String(k)))}</b> <span class="hint">${n}</span>`);
    s.style.cssText='cursor:pointer;padding:3px 0';
    d.appendChild(s);
    if (depth<1) d.open = true;
    d.appendChild(tree(v,depth+1));
    wrap.appendChild(d);
  });
  return wrap;
}

