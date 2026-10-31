/** Hann-windowed radix-2 FFT, normalized to 64 logarithmic bands. */
export function spectrum(samples: Float32Array, rate = 48000): number[] {
  const n = samples.length
  if (n < 2 || n & n-1) throw new Error('FFT size must be a power of two')
  const real = new Float64Array(n), imaginary = new Float64Array(n)
  for (let i=0;i<n;i++) real[i] = samples[i] * (0.5-0.5*Math.cos(2*Math.PI*i/(n-1)))
  for (let i=1,j=0;i<n;i++) { let bit=n>>1; for (;j&bit;bit>>=1) j^=bit; j^=bit; if (i<j) [real[i],real[j]]=[real[j],real[i]] }
  for (let length=2;length<=n;length<<=1) {
    const angle=-2*Math.PI/length
    for (let base=0;base<n;base+=length) for (let j=0;j<length/2;j++) {
      const c=Math.cos(angle*j),s=Math.sin(angle*j),a=base+j,b=a+length/2,tr=real[b]*c-imaginary[b]*s,ti=real[b]*s+imaginary[b]*c
      real[b]=real[a]-tr; imaginary[b]=imaginary[a]-ti; real[a]+=tr; imaginary[a]+=ti
    }
  }
  return Array.from({length:64},(_,index)=>{
    const lo=20*Math.pow(1000,index/64),hi=20*Math.pow(1000,(index+1)/64)
    const begin=Math.max(1,Math.floor(lo*n/rate)),end=Math.min(n/2,Math.max(begin+1,Math.ceil(hi*n/rate)))
    let peak=0
    for (let bin=begin;bin<end;bin++) peak=Math.max(peak,Math.hypot(real[bin],imaginary[bin])*4/n)
    return Math.max(0,Math.min(1,(20*Math.log10(peak+1e-12)+80)/80))
  })
}
