"""Independent decimal corpus; Python Decimal is not the production TypeScript core."""
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path
import json, random, subprocess
rng = random.Random(20261003)
def quant(text, scale):
    return format(Decimal(text).quantize(Decimal(1).scaleb(-scale), rounding=ROUND_HALF_UP), 'f')
with localcontext() as ctx:
    ctx.prec = 100
    cases=[]
    for scale in (0,2,3,6):
        for value in ('1.005','-1.005','0.335','-0.335','1.0049','-0.004','2.5','-2.5','1.2345','-1.2345','9999999999.99','-9999999999.99'):
            output=quant(value,scale)
            if Decimal(output)==0: output=format(Decimal(0).quantize(Decimal(1).scaleb(-scale)),'f')
            cases.append({'input':value,'scale':scale,'expected':output})
    for _ in range(80):
        coeff=rng.randrange(-999999999999,999999999999)
        value=format(Decimal(coeff).scaleb(-rng.randrange(0,9)), 'f')
        scale=rng.choice((0,2,3,6));output=quant(value,scale)
        if Decimal(output)==0: output=format(Decimal(0).quantize(Decimal(1).scaleb(-scale)),'f')
        cases.append({'input':value,'scale':scale,'expected':output})
    line=[]
    for q,p,d in [('3','0.335','0'),('0.5','1.005','0'),('3','0.335','0.01'),('1.5','6.6667','0.01'),('1','1.005','1.00'),('1','1.005','1.01')]:
        line.append({'qty':q,'price':p,'discount':d,'expected':format(Decimal(quant(str(Decimal(q)*Decimal(p)),2))-Decimal(d),'.2f')})
    allocations=[]
    for total,count in [('-0.05',2),('0.05',2),('100',3),('-100',3),('0.01',100),('0',4),('1.005',7)]:
        minor=int(Decimal(quant(total,2))*100);sign=-1 if minor<0 else 1;base,extra=divmod(abs(minor),count)
        slots=[sign*(base+(i<extra)) for i in range(count)]
        assert sum(slots)==minor
        allocations.append({'input':total,'scale':2,'count':count,'expectedMinor':[str(v) for v in slots]})
    result={'provenance':'Python Decimal ROUND_HALF_UP with precision 100; seed 20261003; independently generated before production implementation','quantize':cases,'lines':line,'allocations':allocations}
target = Path(__file__).with_name('decimal-oracle.json')
target.write_text(json.dumps(result,indent=2)+'\n')
# Canonical repository formatting makes regeneration byte-for-byte reproducible.
subprocess.run(['bunx', 'prettier', '--write', str(target)], cwd=Path(__file__).resolve().parents[3], check=True)
print(json.dumps({k:len(v) for k,v in result.items() if isinstance(v,list)}))
